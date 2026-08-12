import type { WebSocket } from "ws";
import type { CallState } from "../types/call";
import { createCall, getCall, setCallStatus } from "../call/callManager";
import {
  addMessage,
  addQuestion,
  mergeExtractedData,
} from "../call/callState";
import { env } from "../config/env";
import { parseLanguage, type Language } from "../config/language";
import {
  FALLBACK_MESSAGES,
  LOCALIZED_ERRORS,
  SCREENING_GREETINGS,
} from "../config/screeningGreeting";
import { DeepgramSttService } from "../services/deepgramStt.service";
import { ElevenLabsProvider } from "../services/tts/elevenlabs.provider";
import { TtsService } from "../services/tts/tts.service";
import { llmService } from "../services/llm/llm.service";
import { generateReport } from "../services/report.service";
import { toErrorMessage } from "../utils/errors";

const WAIT_FOR_TURN_TIMEOUT_MS = 4000;
const CLOSE_AFTER_MESSAGES_MS = 300;

interface IncomingClientMessage {
  type?: unknown;
  language?: unknown;
}

/**
 * Manages a single client WebSocket connection for one call.
 *
 * Wire protocol (frontend -> backend):
 *   { type: "start_call" }   // language is auto-detected, no manual selection
 *   { type: "end_call" }
 *   binary: raw linear16 PCM @16kHz mono microphone audio
 *
 * Wire protocol (backend -> frontend):
 *   { type: "call_started", callId, language }
 *   { type: "language_changed", language }
 *   { type: "transcript_interim", text }
 *   { type: "transcript_final", text }
 *   { type: "user_speaking_start" }
 *   { type: "ai_message", text }
 *   { type: "ai_speaking_start" }
 *   binary: raw linear16 PCM TTS audio
 *   { type: "ai_speaking_end" }
 *   { type: "report", report }
 *   { type: "call_ended" }
 *   { type: "error", message }
 *
 * STT uses a single Deepgram "multi" connection for the whole call. The LLM
 * detects the language of each finalized user utterance and returns
 * responseLanguage; that value drives the reply text and the ElevenLabs voice.
 */
export class CallSocket {
  private readonly ws: WebSocket;
  private stt: DeepgramSttService | null = null;
  private tts: TtsService | null = null;

  private call: CallState | null = null;
  private ending = false;
  private closed = false;
  private failedToStart = false;

  private currentUtterance = "";
  private turnQueue: string[] = [];
  private turnInProgress = false;
  private turnPromise: Promise<void> = Promise.resolve();
  private ttsActive = false;

  constructor(ws: WebSocket, initialCallId?: string) {
    this.ws = ws;

    this.ws.on("message", (data, isBinary) => {
      if (isBinary) {
        this.stt?.sendAudio(data as Buffer);
        return;
      }
      this.handleMessage(data.toString());
    });

    this.ws.on("close", () => this.handleSocketClose());
    this.ws.on("error", () => this.handleSocketClose());

    if (initialCallId) {
      const existing = getCall(initialCallId);
      if (existing && existing.status === "active") {
        this.call = existing;
      }
    }
  }

  /* ------------------------------------------------------------------ */
  /* Message handling                                                   */
  /* ------------------------------------------------------------------ */

  private handleMessage(raw: string): void {
    let parsed: IncomingClientMessage;
    try {
      parsed = JSON.parse(raw) as IncomingClientMessage;
    } catch {
      return;
    }

    if (parsed.type === "start_call") {
      void this.startCall(parsed.language);
      return;
    }

    if (parsed.type === "end_call") {
      void this.endCall();
      return;
    }

    // Unknown message types are ignored safely.
  }

  private async startCall(language: unknown): Promise<void> {
    const lang = parseLanguage(language) ?? "en";

    if (!this.call) {
      this.call = createCall(lang);
    } else {
      this.call.language = lang;
    }
    if (this.call.status !== "active") {
      return;
    }

    const greeting = SCREENING_GREETINGS[this.call.language];

    console.log(
      `[CALL] Starting voice session (${this.call.callId}, language: ${this.call.language})`,
    );

    this.createServices();

    const ttsConfigError = this.tts!.getConfigurationError();
    if (ttsConfigError) {
      console.error(`[CALL] TTS not configured: ${ttsConfigError}`);
      this.failedToStart = true;
      this.send({
        type: "error",
        message: LOCALIZED_ERRORS[this.call.language].ttsUnavailable,
      });
      this.closeAfterError();
      return;
    }

    this.send({
      type: "call_started",
      callId: this.call.callId,
      language: this.call.language,
    });

    this.stt!.connect();

    addMessage(this.call, "assistant", greeting);
    this.send({ type: "ai_message", text: greeting });
    await this.speakReply(greeting, this.call.language);
  }

  private createServices(): void {
    this.stt = new DeepgramSttService({
      onOpen: () => {
        // Connection logging is handled inside the STT service.
      },
      onSpeechStarted: () => this.handleSpeechStarted(),
      onInterimTranscript: (text) =>
        this.send({ type: "transcript_interim", text }),
      onFinalTranscript: (text) => {
        this.currentUtterance = text;
      },
      onUtteranceEnd: () => this.handleUtteranceEnd(),
      onError: (error) => {
        console.error("[STT] error", toErrorMessage(error));
        this.send({
          type: "error",
          message: FALLBACK_MESSAGES[this.call?.language ?? "en"].error,
        });
      },
      onClose: () => {},
    });

    this.tts = new TtsService(new ElevenLabsProvider(env));
  }

  private closeAfterError(): void {
    try {
      this.ws.close();
    } catch {
      // ignore
    }
  }

  /* ------------------------------------------------------------------ */
  /* Turn processing                                                    */
  /* ------------------------------------------------------------------ */

  private handleUtteranceEnd(): void {
    const text = this.currentUtterance.trim();
    this.currentUtterance = "";
    if (!text) return;

    if (this.ending || !this.call) {
      return;
    }

    this.turnQueue.push(text);
    void this.processTurns();
  }

  private async processTurns(): Promise<void> {
    if (this.turnInProgress) return;
    this.turnInProgress = true;

    try {
      while (this.turnQueue.length > 0 && !this.ending && this.call) {
        const utterance = this.turnQueue.shift()!;
        this.turnPromise = this.processTurn(utterance);
        await this.turnPromise;
      }
    } finally {
      this.turnInProgress = false;
    }
  }

  private async processTurn(utterance: string): Promise<void> {
    const call = this.call;
    if (!call) return;

    console.log(`[STT] Final transcript: ${utterance}`);
    this.send({ type: "transcript_final", text: utterance });
    addMessage(call, "user", utterance);

    let reply = FALLBACK_MESSAGES[call.language].empty;

    try {
      console.log("[LLM] Processing turn");
      const response = await llmService.generateConversationTurn(call, utterance);
      console.log("[LLM] Response generated");

      mergeExtractedData(call, response.extractedData);
      addQuestion(call, response.nextField);

      const responseLanguage: Language =
        response.responseLanguage === "hi" ? "hi" : "en";
      if (responseLanguage !== call.language) {
        console.log(
          `[CALL] Conversation language switched: ${call.language} -> ${responseLanguage}`,
        );
      }
      call.language = responseLanguage;
      this.send({ type: "language_changed", language: responseLanguage });

      reply = response.reply.trim() || FALLBACK_MESSAGES[call.language].empty;
    } catch (error) {
      console.error("[LLM] turn failed", error);
      reply = FALLBACK_MESSAGES[call.language].error;
    }

    if (this.ending) return;

    addMessage(call, "assistant", reply);
    this.send({ type: "ai_message", text: reply });
    await this.speakReply(reply, call.language);
  }

  private speakReply(text: string, language: Language): Promise<void> {
    return new Promise<void>((resolve) => {
      this.send({ type: "ai_speaking_start" });
      this.ttsActive = true;

      this.tts!.speak(
        { text, language },
        {
          onAudio: (chunk) => this.sendBinary(chunk),
          onStart: () => {},
          onComplete: () => {
            this.ttsActive = false;
            this.send({ type: "ai_speaking_end" });
            resolve();
          },
          onError: (error) => {
            this.ttsActive = false;
            this.send({ type: "ai_speaking_end" });
            if (
              error.message !== "TTS interrupted" &&
              error.message !== "Interrupted by new speech"
            ) {
              console.error("[TTS] synthesis error", error.message);
            }
            resolve();
          },
        },
      );
    });
  }

  /* ------------------------------------------------------------------ */
  /* Barge-in                                                           */
  /* ------------------------------------------------------------------ */

  private handleSpeechStarted(): void {
    this.send({ type: "user_speaking_start" });

    if (this.ttsActive) {
      console.log("[CALL] User interrupted AI speech");
      this.tts?.interrupt();
      this.ttsActive = false;
      this.send({ type: "ai_speaking_end" });
    }
  }

  /* ------------------------------------------------------------------ */
  /* End call                                                           */
  /* ------------------------------------------------------------------ */

  private async endCall(): Promise<void> {
    const call = this.call;
    if (!call || this.ending) return;

    this.ending = true;
    setCallStatus(call.callId, "ending");
    console.log("[CALL] Ending call");

    this.stt?.finalize();

    if (this.turnInProgress) {
      await Promise.race([
        this.turnPromise.catch(() => {}),
        new Promise<void>((resolve) =>
          setTimeout(resolve, WAIT_FOR_TURN_TIMEOUT_MS),
        ),
      ]);
    }

    if (this.currentUtterance.trim()) {
      addMessage(call, "user", this.currentUtterance.trim());
      this.currentUtterance = "";
    }

    const report = await generateReport(call);
    call.report = report;
    setCallStatus(call.callId, "completed");

    this.send({ type: "report", report });
    this.send({ type: "call_ended" });
    console.log("[CALL] Call ended");

    this.cleanup();
    setTimeout(() => {
      try {
        this.ws.close();
      } catch {
        // ignore
      }
    }, CLOSE_AFTER_MESSAGES_MS);
  }

  private handleSocketClose(): void {
    if (this.closed) return;
    this.closed = true;

    const call = this.call;
    if (call && call.status === "active" && !this.ending && !this.failedToStart) {
      console.log("[CALL] Socket closed unexpectedly, finalizing call");
      this.ending = true;
      void generateReport(call).then((report) => {
        call.report = report;
        setCallStatus(call.callId, "completed");
      });
    }

    this.cleanup();
  }

  private cleanup(): void {
    this.stt?.close();
    this.tts?.close();
    this.stt = null;
    this.tts = null;
  }

  /* ------------------------------------------------------------------ */
  /* Helpers                                                            */
  /* ------------------------------------------------------------------ */

  private send(message: unknown): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(JSON.stringify(message));
    } catch {
      // ignore
    }
  }

  private sendBinary(chunk: Buffer): void {
    if (this.closed || this.ws.readyState !== this.ws.OPEN) return;
    try {
      this.ws.send(chunk, { binary: true });
    } catch {
      // ignore
    }
  }
}
