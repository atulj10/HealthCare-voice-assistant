/* ------------------------------------------------------------------ */
/* Provider-independent LLM types                                      */
/* ------------------------------------------------------------------ */

import type { Language } from "../../config/language";

export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface CollectedHealthData {
  name: string | null;
  mainConcern: string | null;
  duration: string | null;
  severity: string | null;
  relatedSymptoms: string[];
  otherRelevantInformation: string[];
}

export interface ScreeningInput {
  conversation: ConversationMessage[];
  collectedData: CollectedHealthData;
  askedQuestions: string[];
  latestUserMessage: string;
  language: Language;
}

export interface ScreeningResponse {
  reply: string;
  responseLanguage: Language;
  extractedData: CollectedHealthData;
  nextField: string | null;
  needsClarification: boolean;
  screeningComplete: boolean;
}

export interface HealthReportInput {
  conversation: ConversationMessage[];
  collectedData: CollectedHealthData;
  language: Language;
}

export type InformationCompleteness = "limited" | "partial" | "good";

export interface HealthReport {
  patientName: string | null;
  mainConcern: string | null;
  keySymptoms: string[];
  duration: string | null;
  severity: string | null;
  followUp: string[];
  redFlags: string[];
  otherRelevantInformation: string[];
  informationCompleteness: InformationCompleteness;
  summary: string;
}

export type ProviderName = "gemini" | "cerebras";

export type LLMErrorCode =
  | "RATE_LIMIT"
  | "AUTH_ERROR"
  | "TIMEOUT"
  | "INVALID_RESPONSE"
  | "SERVER_ERROR"
  | "UNKNOWN";

/**
 * Normalized error thrown by LLM providers. Business logic must only ever
 * see this error type; provider-specific SDK errors are translated into it.
 */
export class LLMProviderError extends Error {
  readonly provider: ProviderName;
  readonly code: LLMErrorCode;

  constructor(provider: ProviderName, code: LLMErrorCode, message?: string) {
    super(message ?? `${provider} ${code}`);
    this.name = "LLMProviderError";
    this.provider = provider;
    this.code = code;
  }
}

export function isLLMProviderError(error: unknown): error is LLMProviderError {
  return error instanceof LLMProviderError;
}

/**
 * Errors for which automatic fallback to the secondary provider SHOULD occur.
 */
export function isTemporaryLLMError(error: unknown): boolean {
  return (
    isLLMProviderError(error) &&
    (error.code === "RATE_LIMIT" ||
      error.code === "TIMEOUT" ||
      error.code === "SERVER_ERROR")
  );
}
