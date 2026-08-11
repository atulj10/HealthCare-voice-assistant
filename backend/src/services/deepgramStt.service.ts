import {
  createClient,
  LiveTranscriptionEvents,
  type ListenLiveClient,
  type LiveTranscriptionEvent,
} from "@deepgram/sdk";
import { env } from "../config/env";
import { toErrorMessage } from "../utils/errors";

export interface SttEventHandlers {
  onOpen: () => void;
  onSpeechStarted: () => void;
  onInterimTranscript: (text: string) => void;
  onFinalTranscript: (text: string) => void;
  onUtteranceEnd: () => void;
  onError: (error: Error) => void;
  onClose: () => void;
}

/**
 * Wraps a persistent Deepgram streaming STT connection for a single call.
 * Raw PCM audio chunks are forwarded from the browser to Deepgram.
 *
 * Audio arriving before the socket is open is buffered and flushed on open
 * so the first moments of the call are not lost.
 */
export class DeepgramSttService {
  private connection: ListenLiveClient | null = null;
  private opened = false;
  private closedByUs = false;
  private pending: ArrayBuffer[] = [];
  private readonly handlers: SttEventHandlers;

  constructor(handlers: SttEventHandlers) {
    this.handlers = handlers;
  }

  connect(): void {
    if (this.connection) return;

    if (!env.DEEPGRAM_API_KEY) {
      this.handlers.onError(
        new Error("DEEPGRAM_API_KEY is not configured on the backend"),
      );
      return;
    }

    const client = createClient(env.DEEPGRAM_API_KEY);
    const connection = client.listen.live({
      model: env.DEEPGRAM_STT_MODEL,
      language: "en-US",
      encoding: "linear16",
      sample_rate: env.TTS_SAMPLE_RATE,
      channels: 1,
      interim_results: true,
      endpointing: false,
      utterance_end_ms: 1000,
      punctuate: true,
      smart_format: true,
      vad_events: true,
    });

    this.connection = connection;
    this.pending = [];

    connection.on(LiveTranscriptionEvents.Open, () => {
      console.log("[STT] Connected");
      this.opened = true;
      const buffered = this.pending;
      this.pending = [];
      for (const chunk of buffered) {
        this.sendChunk(chunk);
      }
      this.handlers.onOpen();
    });

    connection.on(LiveTranscriptionEvents.SpeechStarted, () => {
      this.handlers.onSpeechStarted();
    });

    connection.on(LiveTranscriptionEvents.Transcript, (raw) => {
      const data = raw as LiveTranscriptionEvent;
      const transcript = data.channel?.alternatives?.[0]?.transcript ?? "";
      if (!transcript) return;
      if (data.is_final) {
        this.handlers.onFinalTranscript(transcript);
      } else {
        this.handlers.onInterimTranscript(transcript);
      }
    });

    connection.on(LiveTranscriptionEvents.UtteranceEnd, () => {
      this.handlers.onUtteranceEnd();
    });

    connection.on(LiveTranscriptionEvents.Error, (error) => {
      console.error("[STT] Error", toErrorMessage(error));
      this.handlers.onError(new Error(toErrorMessage(error)));
    });

    connection.on(LiveTranscriptionEvents.Close, () => {
      console.log("[STT] Closed");
      this.connection = null;
      this.opened = false;
      if (!this.closedByUs) this.handlers.onClose();
    });
  }

  sendAudio(chunk: Buffer | ArrayBuffer): void {
    const data = Buffer.isBuffer(chunk)
      ? (chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength,
        ) as ArrayBuffer)
      : chunk;

    if (this.opened && this.connection && this.connection.isConnected()) {
      this.sendChunk(data);
      return;
    }

    if (!this.closedByUs) {
      this.pending.push(data);
    }
  }

  private sendChunk(data: ArrayBuffer): void {
    this.connection?.send(data);
  }

  /**
   * Flushes any transcription sitting in Deepgram's buffer. Used on call end.
   */
  finalize(): void {
    try {
      this.connection?.finalize();
    } catch {
      // ignore
    }
  }

  close(): void {
    this.closedByUs = true;
    this.pending = [];
    try {
      this.connection?.requestClose();
    } catch {
      // ignore
    }
    this.connection = null;
    this.opened = false;
  }
}
