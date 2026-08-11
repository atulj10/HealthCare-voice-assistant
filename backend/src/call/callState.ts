import type { CallState, CollectedData } from "../types/call";

export function emptyCollectedData(): CollectedData {
  return {
    name: null,
    mainConcern: null,
    duration: null,
    severity: null,
    relatedSymptoms: [],
    otherRelevantInformation: [],
  };
}

export function createCallState(callId: string): CallState {
  return {
    callId,
    status: "active",
    createdAt: Date.now(),
    language: "en",
    messages: [],
    collectedData: emptyCollectedData(),
    askedQuestions: [],
  };
}

export function addMessage(
  state: CallState,
  role: "user" | "assistant",
  content: string,
): void {
  state.messages.push({
    role,
    content,
    timestamp: new Date().toISOString(),
  });
}

export function addQuestion(state: CallState, field: string | null): void {
  if (!field) return;
  if (state.askedQuestions.includes(field)) return;
  state.askedQuestions.push(field);
}

function appendUnique(target: string[], incoming: string[]): void {
  const normalized = new Set(target.map((item) => item.trim().toLowerCase()));
  for (const item of incoming) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (normalized.has(trimmed.toLowerCase())) continue;
    normalized.add(trimmed.toLowerCase());
    target.push(trimmed);
  }
}

function firstNonEmpty(current: string | null, incoming: string | null): string | null {
  if (incoming && incoming.trim().length > 0) return incoming.trim();
  return current;
}

/**
 * Merge data extracted by Gemini into the persisted call state.
 * Never overwrites existing useful information with null or empty values.
 */
export function mergeExtractedData(state: CallState, extracted: CollectedData): void {
  const data = state.collectedData;
  data.name = firstNonEmpty(data.name, extracted.name);
  data.mainConcern = firstNonEmpty(data.mainConcern, extracted.mainConcern);
  data.duration = firstNonEmpty(data.duration, extracted.duration);
  data.severity = firstNonEmpty(data.severity, extracted.severity);
  appendUnique(data.relatedSymptoms, extracted.relatedSymptoms);
  appendUnique(data.otherRelevantInformation, extracted.otherRelevantInformation);
}
