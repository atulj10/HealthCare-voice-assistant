/* ------------------------------------------------------------------ */
/* Provider-independent TTS types                                      */
/* ------------------------------------------------------------------ */

import type { Language } from "../../config/language";

export interface TTSInput {
  text: string;
  language: Language;
}

export interface TTSResult {
  /** Raw audio bytes in the shared pipeline format (Int16 PCM @ TTS_SAMPLE_RATE). */
  audio: Buffer;
  sampleRate: number;
}

/** Options accepted by TTSProvider.synthesize. */
export interface TTSSynthesizeOptions {
  /** Aborts the in-flight synthesis (used for barge-in). */
  signal?: AbortSignal;
  /**
   * Progressive audio delivery: called with raw audio chunks as they are
   * streamed, before the synthesis promise resolves.
   */
  onChunk?: (chunk: Buffer) => void;
}

/**
 * The only interface the conversation logic depends on. Implementations
 * (ElevenLabs, ...) must normalize their errors into TTSServiceError.
 */
export interface TTSProvider {
  readonly name: string;
  /**
   * Returns a human-readable message describing the first missing piece of
   * configuration (API key, model, voices), or null when fully configured.
   */
  getConfigurationError(): string | null;
  synthesize(input: TTSInput, options?: TTSSynthesizeOptions): Promise<TTSResult>;
}

export type TTSErrorCode =
  | "CONFIG"
  | "AUTH"
  | "RATE_LIMIT"
  | "NETWORK"
  | "SERVER"
  | "INVALID_REQUEST"
  | "UNKNOWN";

/**
 * Normalized error thrown by TTS providers. Business logic must only ever
 * see this error type; provider-specific errors are translated into it.
 */
export class TTSServiceError extends Error {
  readonly provider: string;
  readonly code: TTSErrorCode;

  constructor(provider: string, code: TTSErrorCode, message?: string) {
    super(message ?? `${provider} ${code}`);
    this.name = "TTSServiceError";
    this.provider = provider;
    this.code = code;
  }
}

export function isTTSServiceError(error: unknown): error is TTSServiceError {
  return error instanceof TTSServiceError;
}
