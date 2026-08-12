import { describe, expect, it } from "vitest";
import { normalizeGeminiError } from "./gemini.provider";
import { LLMProviderError } from "./types";

function sdkError(name: string, message: string): Error {
  const error = new Error(message);
  error.name = name;
  return error;
}

describe("normalizeGeminiError", () => {
  it("maps 429 quota errors to RATE_LIMIT", () => {
    const error = sdkError(
      "ClientError",
      "got status: 429 Too Many Requests. {\"error\":{\"code\":429}}",
    );
    const normalized = normalizeGeminiError(error);
    expect(normalized).toBeInstanceOf(LLMProviderError);
    expect(normalized.provider).toBe("gemini");
    expect(normalized.code).toBe("RATE_LIMIT");
  });

  it("maps server errors to SERVER_ERROR", () => {
    const error = sdkError(
      "ServerError",
      "got status: 503 Service Unavailable. {}",
    );
    const normalized = normalizeGeminiError(error);
    expect(normalized.code).toBe("SERVER_ERROR");
  });

  it("maps auth errors to AUTH_ERROR", () => {
    const error = sdkError(
      "ClientError",
      "got status: 403 Forbidden. {\"error\":{\"code\":403}}",
    );
    const normalized = normalizeGeminiError(error);
    expect(normalized.code).toBe("AUTH_ERROR");
  });

  it("passes through LLMProviderError unchanged", () => {
    const original = new LLMProviderError("gemini", "TIMEOUT", "already normalized");
    expect(normalizeGeminiError(original)).toBe(original);
  });

  it("maps other client errors to UNKNOWN", () => {
    const error = sdkError("ClientError", "got status: 400 Bad Request. {}");
    const normalized = normalizeGeminiError(error);
    expect(normalized.code).toBe("UNKNOWN");
  });
});
