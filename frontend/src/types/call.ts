export type Language = "en" | "hi";

export type CallStatus =
  | "idle"
  | "connecting"
  | "active"
  | "processing"
  | "ai-speaking"
  | "ending"
  | "completed"
  | "error";

export type MessageRole = "user" | "assistant";

export interface TranscriptMessage {
  role: MessageRole;
  content: string;
}

export interface HealthReport {
  patientName: string | null;
  mainConcern: string | null;
  keySymptoms: string[];
  duration: string | null;
  severity: string | null;
  followUp: string[];
  redFlags: string[];
  otherRelevantInformation: string[];
  informationCompleteness: "limited" | "partial" | "good";
  summary: string;
}

export interface ServerMessage {
  type: string;
  [key: string]: unknown;
}
