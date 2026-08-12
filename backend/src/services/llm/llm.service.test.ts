import { describe, expect, it, vi } from "vitest";
import type { CallState } from "../../types/call";
import type { LLMProvider } from "./provider";
import { createLLMService } from "./llm.service";
import {
  LLMProviderError,
  type HealthReport,
  type ScreeningResponse,
} from "./types";

function makeState(overrides: Partial<CallState> = {}): CallState {
  return {
    callId: "call-test",
    status: "active",
    createdAt: 0,
    language: "en",
    messages: [],
    collectedData: {
      name: null,
      mainConcern: null,
      duration: null,
      severity: null,
      relatedSymptoms: [],
      otherRelevantInformation: [],
    },
    askedQuestions: [],
    ...overrides,
  };
}

const screeningResponse: ScreeningResponse = {
  reply: "Hello!",
  responseLanguage: "en",
  extractedData: {
    name: null,
    mainConcern: null,
    duration: null,
    severity: null,
    relatedSymptoms: [],
    otherRelevantInformation: [],
  },
  nextField: "name",
  needsClarification: false,
  screeningComplete: false,
};

const healthReport: HealthReport = {
  patientName: null,
  mainConcern: null,
  keySymptoms: [],
  duration: null,
  severity: null,
  followUp: [],
  redFlags: [],
  otherRelevantInformation: [],
  informationCompleteness: "limited",
  summary: "No information collected.",
};

function makeProviders(overrides: Partial<Record<keyof LLMProvider, unknown>>) {
  const primary: LLMProvider = {
    generateScreeningResponse: vi.fn().mockResolvedValue(screeningResponse),
    generateHealthReport: vi.fn().mockResolvedValue(healthReport),
    ...(overrides as Partial<LLMProvider>),
  };
  const secondary: LLMProvider = {
    generateScreeningResponse: vi.fn().mockResolvedValue(screeningResponse),
    generateHealthReport: vi.fn().mockResolvedValue(healthReport),
  };
  return { primary, secondary };
}

describe("createLLMService fallback", () => {
  it("uses the primary provider when it succeeds", async () => {
    const { primary, secondary } = makeProviders({});
    const service = createLLMService({ primary, secondary });

    const result = await service.generateConversationTurn(makeState(), "Hi");

    expect(result.reply).toBe("Hello!");
    expect(primary.generateScreeningResponse).toHaveBeenCalledOnce();
    expect(secondary.generateScreeningResponse).not.toHaveBeenCalled();
  });

  it("falls back to the secondary provider on rate limits", async () => {
    const primary = {
      ...makeProviders({}).primary,
      generateScreeningResponse: vi
        .fn()
        .mockRejectedValue(
          new LLMProviderError("gemini", "RATE_LIMIT", "quota exceeded"),
        ),
    };
    const { secondary } = makeProviders({});
    const service = createLLMService({ primary, secondary });

    const result = await service.generateConversationTurn(makeState(), "Hi");

    expect(result.reply).toBe("Hello!");
    expect(secondary.generateScreeningResponse).toHaveBeenCalledOnce();
  });

  it("does not fall back on auth errors", async () => {
    const primary = {
      ...makeProviders({}).primary,
      generateScreeningResponse: vi
        .fn()
        .mockRejectedValue(
          new LLMProviderError("gemini", "AUTH_ERROR", "bad key"),
        ),
    };
    const { secondary } = makeProviders({});
    const service = createLLMService({ primary, secondary });

    await expect(
      service.generateConversationTurn(makeState(), "Hi"),
    ).rejects.toBeInstanceOf(LLMProviderError);
    expect(secondary.generateScreeningResponse).not.toHaveBeenCalled();
  });

  it("rejects when both providers fail", async () => {
    const primary = {
      ...makeProviders({}).primary,
      generateScreeningResponse: vi
        .fn()
        .mockRejectedValue(
          new LLMProviderError("gemini", "SERVER_ERROR", "down"),
        ),
    };
    const secondary = {
      ...makeProviders({}).secondary,
      generateScreeningResponse: vi
        .fn()
        .mockRejectedValue(
          new LLMProviderError("cerebras", "RATE_LIMIT", "also down"),
        ),
    };
    const service = createLLMService({ primary, secondary });

    await expect(
      service.generateConversationTurn(makeState(), "Hi"),
    ).rejects.toMatchObject({ code: "RATE_LIMIT", provider: "cerebras" });
  });

  it("applies the same fallback to health report generation", async () => {
    const primary = {
      ...makeProviders({}).primary,
      generateHealthReport: vi
        .fn()
        .mockRejectedValue(
          new LLMProviderError("gemini", "TIMEOUT", "timed out"),
        ),
    };
    const { secondary } = makeProviders({});
    const service = createLLMService({ primary, secondary });

    const result = await service.generateHealthReport(makeState());

    expect(result.informationCompleteness).toBe("limited");
    expect(secondary.generateHealthReport).toHaveBeenCalledOnce();
  });

  it("passes the call language through to the provider", async () => {
    const { primary } = makeProviders({});
    const { secondary } = makeProviders({});
    const service = createLLMService({ primary, secondary });

    const state = makeState({ language: "hi" });
    await service.generateConversationTurn(state, "नमस्ते");
    await service.generateHealthReport(state);

    expect(primary.generateScreeningResponse).toHaveBeenCalledWith(
      expect.objectContaining({ language: "hi" }),
    );
    expect(primary.generateHealthReport).toHaveBeenCalledWith(
      expect.objectContaining({ language: "hi" }),
    );
  });
});
