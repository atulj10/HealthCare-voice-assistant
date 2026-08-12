import { GoogleGenAI, Type, type Schema } from "@google/genai";
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

const screeningSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
    responseLanguage: { type: Type.STRING, enum: ["en", "hi"] },
    extractedData: {
      type: Type.OBJECT,
      properties: {
        name: { type: Type.STRING, nullable: true },
        mainConcern: { type: Type.STRING, nullable: true },
        duration: { type: Type.STRING, nullable: true },
        severity: { type: Type.STRING, nullable: true },
        relatedSymptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
        otherRelevantInformation: {
          type: Type.ARRAY,
          items: { type: Type.STRING },
        },
      },
      required: [
        "name",
        "mainConcern",
        "duration",
        "severity",
        "relatedSymptoms",
        "otherRelevantInformation",
      ],
    },
    nextField: { type: Type.STRING, nullable: true },
    needsClarification: { type: Type.BOOLEAN },
    screeningComplete: { type: Type.BOOLEAN },
  },
  required: [
    "reply",
    "responseLanguage",
    "extractedData",
    "nextField",
    "needsClarification",
    "screeningComplete",
  ],
};

const reportSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    patientName: { type: Type.STRING, nullable: true },
    mainConcern: { type: Type.STRING, nullable: true },
    keySymptoms: { type: Type.ARRAY, items: { type: Type.STRING } },
    duration: { type: Type.STRING, nullable: true },
    severity: { type: Type.STRING, nullable: true },
    followUp: { type: Type.ARRAY, items: { type: Type.STRING } },
    redFlags: { type: Type.ARRAY, items: { type: Type.STRING } },
    otherRelevantInformation: {
      type: Type.ARRAY,
      items: { type: Type.STRING },
    },
    informationCompleteness: {
      type: Type.STRING,
      enum: ["limited", "partial", "good"],
    },
    summary: { type: Type.STRING },
  },
  required: [
    "patientName",
    "mainConcern",
    "keySymptoms",
    "duration",
    "severity",
    "followUp",
    "redFlags",
    "otherRelevantInformation",
    "informationCompleteness",
    "summary",
  ],
};

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("LLM response did not contain JSON");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

/**
 * Translates SDK errors thrown by @google/genai into LLMProviderError.
 * The SDK does not export its error classes or expose HTTP status, so the
 * status is parsed from the message format: "got status: 429 ...".
 */
export function normalizeGeminiError(error: unknown): LLMProviderError {
  if (error instanceof LLMProviderError) {
    return error;
  }

  const name = (error as { name?: string } | null)?.name ?? "";
  const message = error instanceof Error ? error.message : String(error);

  const statusMatch = /got status: (\d{3})/.exec(message);
  const status = statusMatch ? Number(statusMatch[1]) : undefined;

  if (name === "ServerError" || (status !== undefined && status >= 500)) {
    return new LLMProviderError("gemini", "SERVER_ERROR", message);
  }
  if (status === 429) {
    return new LLMProviderError("gemini", "RATE_LIMIT", message);
  }
  if (status === 401 || status === 403) {
    return new LLMProviderError("gemini", "AUTH_ERROR", message);
  }
  if (name === "ClientError") {
    return new LLMProviderError("gemini", "UNKNOWN", message);
  }
  return new LLMProviderError("gemini", "UNKNOWN", message);
}

/**
 * Primary LLM provider backed by Google Gemini.
 */
export class GeminiProvider implements LLMProvider {
  private readonly ai: GoogleGenAI;

  constructor(private readonly env: Env) {
    this.ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? "" });
  }

  private requireApiKey(): void {
    if (!this.env.GEMINI_API_KEY) {
      throw new LLMProviderError(
        "gemini",
        "AUTH_ERROR",
        "GEMINI_API_KEY is not configured on the backend",
      );
    }
  }

  async generateScreeningResponse(
    input: ScreeningInput,
  ): Promise<ScreeningResponse> {
    this.requireApiKey();
    try {
      const result = await this.ai.models.generateContent({
        model: this.env.GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: buildScreeningContext(input) }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: screeningSchema,
          systemInstruction: buildScreeningSystemPrompt(),
          temperature: 0.4,
        },
      });
      const text = result.text;
      if (!text) {
        throw new LLMProviderError("gemini", "INVALID_RESPONSE", "Gemini returned an empty response");
      }
      return conversationResponseSchema.parse(parseJson(text));
    } catch (error) {
      throw normalizeGeminiError(error);
    }
  }

  async generateHealthReport(input: HealthReportInput): Promise<HealthReport> {
    this.requireApiKey();
    try {
      const result = await this.ai.models.generateContent({
        model: this.env.GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: buildReportContext(input) }],
          },
        ],
        config: {
          responseMimeType: "application/json",
          responseSchema: reportSchema,
          systemInstruction: buildReportSystemPrompt(input.language),
          temperature: 0.2,
        },
      });
      const text = result.text;
      if (!text) {
        throw new LLMProviderError("gemini", "INVALID_RESPONSE", "Gemini returned an empty report response");
      }
      return healthReportSchema.parse(parseJson(text));
    } catch (error) {
      throw normalizeGeminiError(error);
    }
  }
}
