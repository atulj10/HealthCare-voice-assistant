import Cerebras, {
  APIError,
  APIConnectionTimeoutError,
  AuthenticationError,
  InternalServerError,
  RateLimitError,
} from "@cerebras/cerebras_cloud_sdk";
import type { Env } from "../../config/env";
import {
  buildScreeningSystemPrompt,
  buildScreeningContext,
} from "../../prompts/screeningPrompt";
import { buildReportSystemPrompt, buildReportContext } from "../../prompts/reportPrompt";
import { conversationResponseSchema } from "../../schemas/conversation.schema";
import { healthReportSchema } from "../../schemas/report.schema";
import type { LLMProvider } from "./provider";
import {
  LLMProviderError,
  type HealthReport,
  type HealthReportInput,
  type ScreeningInput,
  type ScreeningResponse,
} from "./types";

function normalizeError(error: unknown): LLMProviderError {
  if (
    error instanceof RateLimitError ||
    (error instanceof APIError && error.status === 429)
  ) {
    return new LLMProviderError("cerebras", "RATE_LIMIT", error.message);
  }
  if (
    error instanceof AuthenticationError ||
    (error instanceof APIError &&
      (error.status === 401 || error.status === 403))
  ) {
    return new LLMProviderError("cerebras", "AUTH_ERROR", error.message);
  }
  if (error instanceof APIConnectionTimeoutError) {
    return new LLMProviderError("cerebras", "TIMEOUT", error.message);
  }
  if (
    error instanceof InternalServerError ||
    (error instanceof APIError && (error.status ?? 0) >= 500)
  ) {
    return new LLMProviderError("cerebras", "SERVER_ERROR", error.message);
  }
  if (error instanceof LLMProviderError) {
    return error;
  }
  return new LLMProviderError("cerebras", "UNKNOWN", String(error));
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new LLMProviderError(
      "cerebras",
      "INVALID_RESPONSE",
      "Cerebras response did not contain JSON",
    );
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Secondary LLM provider backed by Cerebras. Used as an automatic fallback
 * when the primary provider is rate-limited, times out, or returns a server
 * error.
 */
export class CerebrasProvider implements LLMProvider {
  private readonly client: Cerebras | null;

  constructor(private readonly env: Env) {
    this.client = env.CEREBRAS_API_KEY
      ? new Cerebras({ apiKey: env.CEREBRAS_API_KEY, timeout: 30_000 })
      : null;
  }

  private requireClient(): Cerebras {
    if (!this.client) {
      throw new LLMProviderError(
        "cerebras",
        "AUTH_ERROR",
        "CEREBRAS_API_KEY is not configured on the backend",
      );
    }
    return this.client;
  }

  private async complete(
    systemPrompt: string,
    userContext: string,
    temperature: number,
  ): Promise<string> {
    const client = this.requireClient();
    try {
      const response = await client.chat.completions.create({
        model: this.env.CEREBRAS_MODEL,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContext },
        ],
        temperature,
        response_format: { type: "json_object" },
      });
      if ("error" in response) {
        throw new LLMProviderError(
          "cerebras",
          "SERVER_ERROR",
          `Cerebras returned an error response: ${JSON.stringify(response.error)}`,
        );
      }
      const choice = response.choices?.[0];
      const message = choice && "message" in choice ? choice.message : undefined;
      const text = message?.content;
      if (!text) {
        throw new LLMProviderError(
          "cerebras",
          "INVALID_RESPONSE",
          "Cerebras returned an empty response",
        );
      }
      return text;
    } catch (error) {
      throw normalizeError(error);
    }
  }

  async generateScreeningResponse(
    input: ScreeningInput,
  ): Promise<ScreeningResponse> {
    const text = await this.complete(
      buildScreeningSystemPrompt(),
      buildScreeningContext(input),
      0.4,
    );
    return conversationResponseSchema.parse(parseJson(text));
  }

  async generateHealthReport(input: HealthReportInput): Promise<HealthReport> {
    const text = await this.complete(
      buildReportSystemPrompt(input.language),
      buildReportContext(input),
      0.2,
    );
    return healthReportSchema.parse(parseJson(text));
  }
}
