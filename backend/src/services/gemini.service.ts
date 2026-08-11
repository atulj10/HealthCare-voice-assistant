import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { env } from "../config/env";
import type { CallState } from "../types/call";
import {
  SCREENING_SYSTEM_PROMPT,
  buildScreeningContext,
} from "../prompts/screeningPrompt";
import { REPORT_SYSTEM_PROMPT, buildReportContext } from "../prompts/reportPrompt";
import {
  conversationResponseSchema,
  type ConversationResponse,
} from "../schemas/conversation.schema";
import {
  healthReportSchema,
  type HealthReport,
} from "../schemas/report.schema";

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY ?? "" });

const screeningSchema: Schema = {
  type: Type.OBJECT,
  properties: {
    reply: { type: Type.STRING },
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

function requireApiKey(): void {
  if (!env.GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured on the backend");
  }
}

function parseJson(text: string): unknown {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("Gemini response did not contain JSON");
  }
  return JSON.parse(trimmed.slice(start, end + 1));
}

export async function generateConversationTurn(
  state: CallState,
  latestUtterance: string,
): Promise<ConversationResponse> {
  requireApiKey();
  const result = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: buildScreeningContext(state, latestUtterance) }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: screeningSchema,
      systemInstruction: SCREENING_SYSTEM_PROMPT,
      temperature: 0.4,
    },
  });
  const text = result.text;
  if (!text) {
    throw new Error("Gemini returned an empty response");
  }
  return conversationResponseSchema.parse(parseJson(text));
}

export async function generateHealthReport(
  state: CallState,
): Promise<HealthReport> {
  requireApiKey();
  const result = await ai.models.generateContent({
    model: env.GEMINI_MODEL,
    contents: [
      {
        role: "user",
        parts: [{ text: buildReportContext(state) }],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: reportSchema,
      systemInstruction: REPORT_SYSTEM_PROMPT,
      temperature: 0.2,
    },
  });
  const text = result.text;
  if (!text) {
    throw new Error("Gemini returned an empty report response");
  }
  return healthReportSchema.parse(parseJson(text));
}
