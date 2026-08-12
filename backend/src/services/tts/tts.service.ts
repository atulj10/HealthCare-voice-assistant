import { env } from "../../config/env";
import { ElevenLabsProvider } from "./elevenlabs.provider";
import type { TTSInput, TTSProvider, TTSResult } from "./types";

export interface TTSSpeakHandlers {
  onAudio: (chunk: Buffer) => void;
  onStart: () => void;
  onComplete: () => void;
  onError: (error: Error) => void;
}

interface TtsTask {
  controller: AbortController;
  handlers: TTSSpeakHandlers;
}

/**
 * Application-facing TTS service backed by a provider-independent
 * TTSProvider. Exposes a streaming `speak()` API with barge-in support
 * (matching the previous Deepgram TTS integration) on top of the provider's
 * `synthesize()`.
 */
export class TtsService {
  constructor(private readonly provider: TTSProvider) {}

  get providerName(): string {
    return this.provider.name;
  }

  /** Human-readable configuration error, or null when fully configured. */
  getConfigurationError(): string | null {
    return this.provider.getConfigurationError();
  }

  /** Full-buffer synthesis, used for tests and callers that want the whole clip. */
  synthesize(input: TTSInput): Promise<TTSResult> {
    return this.provider.synthesize(input);
  }

  /**
   * Synthesizes `input.text` in `input.language` and streams the raw audio
   * chunks to `handlers.onAudio`. Audio is forwarded progressively as it
   * arrives from the provider, so playback starts before synthesis ends.
   *
   * Errors are normalized by the provider and delivered to `handlers.onError`.
   * `interrupt()` cancels the in-flight synthesis (barge-in).
   */
  speak(input: TTSInput, handlers: TTSSpeakHandlers): void {
    const configError = this.provider.getConfigurationError();
    if (configError) {
      handlers.onError(new Error(configError));
      return;
    }

    this.replaceCurrentTask();

    const task: TtsTask = {
      controller: new AbortController(),
      handlers,
    };
    this.currentTask = task;

    handlers.onStart();

    void (async () => {
      try {
        await this.provider.synthesize(input, {
          signal: task.controller.signal,
          onChunk: (chunk) => {
            if (this.currentTask === task && !task.controller.signal.aborted) {
              handlers.onAudio(chunk);
            }
          },
        });
        if (this.currentTask === task) {
          this.currentTask = null;
          handlers.onComplete();
        }
      } catch (error) {
        if (this.currentTask === task) {
          this.currentTask = null;
          handlers.onError(
            error instanceof Error ? error : new Error(String(error)),
          );
        }
      }
    })();
  }

  /**
   * Cancels any in-flight synthesis and rejects its handlers. The conversation
   * treats this as "TTS interrupted" (barge-in) and keeps running.
   */
  interrupt(): void {
    const task = this.currentTask;
    if (!task) return;
    this.currentTask = null;
    task.controller.abort();
    task.handlers.onError(new Error("TTS interrupted"));
  }

  close(): void {
    this.interrupt();
  }

  private currentTask: TtsTask | null = null;

  private replaceCurrentTask(): void {
    const previous = this.currentTask;
    if (!previous) return;
    this.currentTask = null;
    previous.controller.abort();
    previous.handlers.onError(new Error("Interrupted by new speech"));
  }
}

/**
 * App-wide TTS service backed by ElevenLabs.
 */
export const ttsService: TtsService = new TtsService(
  new ElevenLabsProvider(env),
);
