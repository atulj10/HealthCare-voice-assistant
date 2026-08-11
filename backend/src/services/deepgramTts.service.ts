import {
  createClient,
  LiveTTSEvents,
  type SpeakLiveClient,
} from "@deepgram/sdk";
import { env } from "../config/env";
import { toErrorMessage } from "../utils/errors";

export interface TtsTaskHandlers {
  onAudio: (chunk: Buffer) => void;
  onStart: () => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

interface TtsTask extends TtsTaskHandlers {
  text: string;
}

/**
 * Wraps a persistent Deepgram streaming TTS connection for a single call.
 * Gemini replies are synthesized and the raw PCM audio is forwarded to the
 * browser.
 *
 * `connect()` resolves once the socket is open so callers never race the
 * connection lifecycle.
 */
export class DeepgramTtsService {
  private connection: SpeakLiveClient | null = null;
  private currentTask: TtsTask | null = null;
  private closedByUs = false;
  private opened = false;
  private openPromise: Promise<void> | null = null;

  connect(): Promise<void> {
    if (this.opened) return Promise.resolve();
    if (this.openPromise) return this.openPromise;

    if (!env.DEEPGRAM_API_KEY) {
      this.openPromise = Promise.reject(
        new Error("DEEPGRAM_API_KEY is not configured on the backend"),
      );
      return this.openPromise;
    }

    this.openPromise = new Promise<void>((resolve, reject) => {
      const client = createClient(env.DEEPGRAM_API_KEY);
      const connection = client.speak.live({
        model: env.DEEPGRAM_TTS_MODEL,
        encoding: "linear16",
        sample_rate: env.TTS_SAMPLE_RATE,
      });

      this.connection = connection;

      connection.on(LiveTTSEvents.Open, () => {
        console.log("[TTS] Connected");
        this.opened = true;
        resolve();
      });

      connection.on(LiveTTSEvents.Audio, (data) => {
        const chunk = Buffer.isBuffer(data)
          ? data
          : Buffer.from(data as ArrayBuffer);
        this.currentTask?.onAudio(chunk);
      });

      connection.on(LiveTTSEvents.Flushed, () => {
        const task = this.currentTask;
        this.currentTask = null;
        if (task) {
          console.log("[TTS] Completed");
          task.onComplete();
        }
      });

      connection.on(LiveTTSEvents.Error, (error) => {
        const err =
          error instanceof Error ? error : new Error(toErrorMessage(error));
        console.error("[TTS] Error", err.message);
        if (!this.opened) {
          this.opened = true; // mark so we don't double-reject
          reject(err);
        }
        const task = this.currentTask;
        this.currentTask = null;
        if (task) task.onError(err);
      });

      connection.on(LiveTTSEvents.Close, () => {
        console.log("[TTS] Closed");
        this.connection = null;
        this.opened = false;
        this.openPromise = null;
        if (!this.closedByUs) {
          const task = this.currentTask;
          this.currentTask = null;
          if (task) task.onError(new Error("TTS connection closed"));
        }
      });
    });

    return this.openPromise;
  }

  speak(text: string, handlers: TtsTaskHandlers): void {
    if (!this.opened || !this.connection || !this.connection.isConnected()) {
      handlers.onError(new Error("TTS connection is not open"));
      return;
    }
    if (this.currentTask) {
      this.currentTask.onError(new Error("Interrupted by new speech"));
    }
    this.currentTask = { text, ...handlers };
    console.log("[TTS] Starting synthesis");
    handlers.onStart();
    this.connection.sendText(text);
    this.connection.flush();
  }

  /**
   * Clears the Deepgram TTS buffer and rejects any in-flight task.
   */
  interrupt(): void {
    if (this.currentTask) {
      const task = this.currentTask;
      this.currentTask = null;
      try {
        this.connection?.clear();
      } catch {
        // ignore
      }
      task.onError(new Error("TTS interrupted"));
    }
  }

  close(): void {
    this.closedByUs = true;
    this.openPromise = null;
    this.opened = false;
    try {
      this.connection?.requestClose();
    } catch {
      // ignore
    }
    this.connection = null;
  }
}
