import type { Env } from "../../config/env";
import type { Language } from "../../config/language";
import {
  TTSServiceError,
  type TTSErrorCode,
  type TTSInput,
  type TTSProvider,
  type TTSResult,
  type TTSSynthesizeOptions,
} from "./types";

export const ELEVENLABS_PROVIDER_NAME = "elevenlabs";

/**
 * Maps a call language to its configured ElevenLabs voice ID.
 * Returns null when the voice is not configured.
 */
export function selectVoiceForLanguage(env: Env, language: Language): string | null {
  return language === "hi" ? env.ELEVENLABS_VOICE_HI ?? null : env.ELEVENLABS_VOICE_EN ?? null;
}

/**
 * Maps the shared audio pipeline sample rate to an ElevenLabs output format.
 * ElevenLabs PCM formats are fixed sample rates; anything unsupported falls
 * back to pcm_16000 (the browser playback default).
 */
export function outputFormatForSampleRate(sampleRate: number): string {
  const supported = new Set([8000, 16000, 22050, 24000, 32000, 44100, 48000]);
  return supported.has(sampleRate) ? `pcm_${sampleRate}` : "pcm_16000";
}

/**
 * Translates an ElevenLabs HTTP status code into the normalized TTSServiceError.
 */
export function normalizeElevenLabsStatus(
  status: number,
  message: string,
): TTSServiceError {
  const code: TTSErrorCode =
    status === 401 || status === 403
      ? "AUTH"
      : status === 422
        ? "INVALID_REQUEST"
        : status === 429
          ? "RATE_LIMIT"
          : status >= 500
            ? "SERVER"
            : "UNKNOWN";
  return new TTSServiceError(ELEVENLABS_PROVIDER_NAME, code, message);
}

/**
 * ElevenLabs Text-to-Speech provider (official REST streaming API).
 *
 * Requests the `/v1/text-to-speech/{voice_id}/stream` endpoint with a raw PCM
 * output format (`pcm_16000` by default) so the bytes are directly compatible
 * with the existing browser playback queue (Int16 PCM @ 16kHz). Audio is
 * forwarded progressively through `onChunk` and also returned as one Buffer.
 *
 * No other part of the backend imports the ElevenLabs API.
 */
export class ElevenLabsProvider implements TTSProvider {
  readonly name = ELEVENLABS_PROVIDER_NAME;

  constructor(private readonly env: Env) {}

  getConfigurationError(): string | null {
    if (!this.env.ELEVENLABS_API_KEY) {
      return "ELEVENLABS_API_KEY is not configured on the backend";
    }
    if (!this.env.ELEVENLABS_MODEL_ID) {
      return "ELEVENLABS_MODEL_ID is not configured on the backend";
    }
    if (!this.env.ELEVENLABS_VOICE_EN) {
      return "ELEVENLABS_VOICE_EN is not configured on the backend";
    }
    if (!this.env.ELEVENLABS_VOICE_HI) {
      return "ELEVENLABS_VOICE_HI is not configured on the backend";
    }
    return null;
  }

  async synthesize(
    input: TTSInput,
    options?: TTSSynthesizeOptions,
  ): Promise<TTSResult> {
    const { text, language } = input;
    const configError = this.getConfigurationError();
    if (configError) {
      throw new TTSServiceError(ELEVENLABS_PROVIDER_NAME, "CONFIG", configError);
    }

    const voiceId = selectVoiceForLanguage(this.env, language)!;
    const outputFormat = outputFormatForSampleRate(this.env.TTS_SAMPLE_RATE);
    const sampleRate = this.env.TTS_SAMPLE_RATE;

    const url = new URL(
      `/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream`,
      this.env.ELEVENLABS_BASE_URL,
    );
    url.searchParams.set("output_format", outputFormat);
    url.searchParams.set(
      "optimize_streaming_latency",
      String(this.env.ELEVENLABS_OPTIMIZE_STREAMING_LATENCY),
    );

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "xi-api-key": this.env.ELEVENLABS_API_KEY!,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          model_id: this.env.ELEVENLABS_MODEL_ID,
        }),
        signal: options?.signal,
      });
    } catch (error) {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new TTSServiceError(
        ELEVENLABS_PROVIDER_NAME,
        "NETWORK",
        error instanceof Error ? error.message : String(error),
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw normalizeElevenLabsStatus(
        response.status,
        `ElevenLabs TTS failed (${response.status}): ${detail.slice(0, 500)}`,
      );
    }

    if (!response.body) {
      throw new TTSServiceError(
        ELEVENLABS_PROVIDER_NAME,
        "SERVER",
        "ElevenLabs TTS returned an empty response body",
      );
    }

    const chunks: Buffer[] = [];
    try {
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        options?.onChunk?.(buffer);
      }
    } catch (error) {
      if (options?.signal?.aborted) {
        throw error;
      }
      throw new TTSServiceError(
        ELEVENLABS_PROVIDER_NAME,
        "NETWORK",
        error instanceof Error ? error.message : String(error),
      );
    }

    return {
      audio: Buffer.concat(chunks),
      sampleRate,
    };
  }
}
