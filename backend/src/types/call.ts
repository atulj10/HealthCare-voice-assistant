export type CallStatus = "active" | "ending" | "completed";

export type MessageRole = "user" | "assistant";

export interface ConversationMessage {
  role: MessageRole;
  content: string;
  timestamp: string;
}

export interface CollectedData {
  name: string | null;
  mainConcern: string | null;
  duration: string | null;
  severity: string | null;
  relatedSymptoms: string[];
  otherRelevantInformation: string[];
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

export interface CallState {
  callId: string;
  status: CallStatus;
  createdAt: number;
  language: "en";
  messages: ConversationMessage[];
  collectedData: CollectedData;
  askedQuestions: string[];
  report?: HealthReport;
}

export interface ClientMessage {
  type: string;
  [key: string]: unknown;
}
