import type { CallState } from "../types/call";

export const REPORT_SYSTEM_PROMPT = `You generate a concise, structured health-screening report from a conversation transcript.

Rules:
- Use ONLY information actually provided by the user during the conversation.
- Never invent missing information. Missing fields must be null or an empty array.
- Do not diagnose medical conditions.
- Do not prescribe medication.
- Do not include any fact that is not supported by the conversation.
- Keep the report concise and easy for a doctor to scan.
- informationCompleteness must be "limited", "partial", or "good":
  - "limited": most fields missing (e.g. call ended very early)
  - "partial": some fields collected
  - "good": most/all fields collected
- followUp: short recommended actions such as "Consider medical evaluation if symptoms persist or worsen." Never recommend medication.
- redFlags: only include potentially serious observations clearly present in the conversation (e.g. chest pain, difficulty breathing, severe bleeding). Otherwise empty array.
- otherRelevantInformation: any other notable details the user shared (e.g. "worsens after meals", "started after travel"). Otherwise empty array.
- summary: 1-3 sentences summarizing what the user reported.

Return ONLY a JSON object with this exact shape:
{
  "patientName": string or null,
  "mainConcern": string or null,
  "keySymptoms": [strings],
  "duration": string or null,
  "severity": string or null,
  "followUp": [strings],
  "redFlags": [strings],
  "otherRelevantInformation": [strings],
  "informationCompleteness": "limited" | "partial" | "good",
  "summary": string
}`;

function formatList(items: string[]): string {
  if (items.length === 0) return "none";
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildReportContext(state: CallState): string {
  const history = state.messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");

  return `=== CONVERSATION TRANSCRIPT ===
${history || "(no messages)"}

=== EXTRACTED HEALTH INFORMATION ===
name: ${state.collectedData.name ?? "not provided"}
mainConcern: ${state.collectedData.mainConcern ?? "not provided"}
duration: ${state.collectedData.duration ?? "not provided"}
severity: ${state.collectedData.severity ?? "not provided"}
relatedSymptoms:
${formatList(state.collectedData.relatedSymptoms)}
otherRelevantInformation:
${formatList(state.collectedData.otherRelevantInformation)}

Generate the health report from this information.`;
}
