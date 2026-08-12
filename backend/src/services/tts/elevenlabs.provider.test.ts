import { describe, expect, it } from "vitest";
import type { Env } from "../../config/env";
import {
  normalizeElevenLabsStatus,
  outputFormatForSampleRate,
  selectVoiceForLanguage,
  ElevenLabsProvider,
} from "./elevenlabs.provider";
import { TTSServiceError } from "./types";

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    BACKEND_PORT: 5000,
    FRONTEND_URL: "http://localhost:5173",
    LLM_PROVIDER: "gemini",
    LLM_FALLBACK_PROVIDER: "cerebras",
    DEEPGRAM_API_KEY: "dg",
    DEEPGRAM_STT_MODEL: "nova-3",
    DEEPGRAM_STT_LANGUAGE: "multi",
    GEMINI_API_KEY: "gemini",
    GEMINI_MODEL: "gemini-3.6-flash",
    CEREBRAS_API_KEY: "cerebras",
    CEREBRAS_MODEL: "gpt-oss-120b",
    ELEVENLABS_API_KEY: "xi",
    ELEVENLABS_MODEL_ID: "eleven_flash_v2_5",
    ELEVENLABS_VOICE_EN: "voice-en",
    ELEVENLABS_VOICE_HI: "voice-hi",
    ELEVENLABS_BASE_URL: "https://api.elevenlabs.io",
    ELEVENLABS_OPTIMIZE_STREAMING_LATENCY: 1,
    TTS_SAMPLE_RATE: 16000,
    ...overrides,
  };
}

describe("selectVoiceForLanguage", () => {
  it("uses the English voice for English", () => {
    expect(selectVoiceForLanguage(makeEnv(), "en")).toBe("voice-en");
  });

  it("uses the Hindi voice for Hindi", () => {
    expect(selectVoiceForLanguage(makeEnv(), "hi")).toBe("voice-hi");
  });

  it("returns null when the voice for a language is not configured", () => {
    const env = makeEnv({ ELEVENLABS_VOICE_HI: undefined });
    expect(selectVoiceForLanguage(env, "hi")).toBeNull();
  });
});

describe("outputFormatForSampleRate", () => {
  it("maps 16kHz to pcm_16000", () => {
    expect(outputFormatForSampleRate(16000)).toBe("pcm_16000");
  });

  it("maps other supported sample rates", () => {
    expect(outputFormatForSampleRate(8000)).toBe("pcm_8000");
    expect(outputFormatForSampleRate(44100)).toBe("pcm_44100");
  });

  it("falls back to pcm_16000 for unsupported sample rates", () => {
    expect(outputFormatForSampleRate(12345)).toBe("pcm_16000");
  });
});

describe("normalizeElevenLabsStatus", () => {
  it("maps 401/403 to AUTH", () => {
    expect(normalizeElevenLabsStatus(401, "bad key").code).toBe("AUTH");
    expect(normalizeElevenLabsStatus(403, "forbidden").code).toBe("AUTH");
  });

  it("maps 422 to INVALID_REQUEST", () => {
    expect(normalizeElevenLabsStatus(422, "validation").code).toBe(
      "INVALID_REQUEST",
    );
  });

  it("maps 429 to RATE_LIMIT", () => {
    expect(normalizeElevenLabsStatus(429, "quota").code).toBe("RATE_LIMIT");
  });

  it("maps 5xx to SERVER", () => {
    expect(normalizeElevenLabsStatus(500, "boom").code).toBe("SERVER");
  });

  it("maps everything else to UNKNOWN", () => {
    expect(normalizeElevenLabsStatus(400, "bad").code).toBe("UNKNOWN");
  });

  it("always produces a TTSServiceError", () => {
    expect(normalizeElevenLabsStatus(429, "quota")).toBeInstanceOf(
      TTSServiceError,
    );
  });
});

describe("ElevenLabsProvider.getConfigurationError", () => {
  it("returns null when fully configured", () => {
    expect(new ElevenLabsProvider(makeEnv()).getConfigurationError()).toBeNull();
  });

  it("names the first missing configuration piece", () => {
    expect(
      new ElevenLabsProvider(makeEnv({ ELEVENLABS_API_KEY: undefined }))
        .getConfigurationError(),
    ).toContain("ELEVENLABS_API_KEY");
    expect(
      new ElevenLabsProvider(makeEnv({ ELEVENLABS_VOICE_EN: undefined }))
        .getConfigurationError(),
    ).toContain("ELEVENLABS_VOICE_EN");
    expect(
      new ElevenLabsProvider(makeEnv({ ELEVENLABS_VOICE_HI: undefined }))
        .getConfigurationError(),
    ).toContain("ELEVENLABS_VOICE_HI");
  });
});
