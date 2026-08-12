import type { Language } from "../config/language";
import type { HealthReportInput } from "../services/llm/types";

const REPORT_SYSTEM_PROMPT = `You generate a concise, structured health-screening report from a conversation transcript.

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

const HINDI_REPORT_SYSTEM_PROMPT = `आप बातचीत की लिपि (ट्रांसक्रिप्ट) से एक संक्षिप्त, संरचित स्वास्थ्य-स्क्रीनिंग रिपोर्ट तैयार करते हैं।

नियम:
- केवल वही जानकारी उपयोग करें जो मरीज़ ने बातचीत के दौरान वास्तव में दी हो।
- लापता जानकारी कभी न बनाएं। लापता फ़ील्ड null या खाली array होने चाहिए।
- चिकित्सा स्थितियों का निदान न करें।
- दवा न लिखें।
- कोई भी ऐसा तथ्य शामिल न करें जो बातचीत से समर्थित न हो।
- रिपोर्ट संक्षिप्त और डॉक्टर के लिए स्कैन करने में आसान रखें।
- informationCompleteness "limited", "partial", या "good" होना चाहिए:
  - "limited": अधिकांश फ़ील्ड लापता (जैसे कॉल बहुत जल्दी समाप्त हो गई)
  - "partial": कुछ फ़ील्ड एकत्र हुए
  - "good": अधिकांश/सभी फ़ील्ड एकत्र हुए
- followUp: छोटी अनुशंसित कार्रवाइयाँ जैसे "यदि लक्षण बने रहें या बढ़ें तो चिकित्सीय मूल्यांकन पर विचार करें।" दवा की कभी अनुशंसा न करें।
- redFlags: केवल उन संभावित गंभीर अवलोकनों को शामिल करें जो बातचीत में स्पष्ट रूप से मौजूद हों (जैसे सीने में दर्द, साँस लेने में कठिनाई, गंभीर रक्तस्राव)। अन्यथा खाली array।
- otherRelevantInformation: कोई भी अन्य उल्लेखनीय विवरण जो मरीज़ ने साझा किया हो (जैसे "खाने के बाद बढ़ता है", "यात्रा के बाद शुरू हुआ")। अन्यथा खाली array।
- summary: 1-3 वाक्य जो सारांशित करें कि मरीज़ ने क्या बताया।
- summary और followUp सहित सभी टेक्स्ट फ़ील्ड हिंदी में लिखें।

केवल इसी सटीक आकार वाला एक JSON ऑब्जेक्ट लौटाएँ:
{
  "patientName": string या null,
  "mainConcern": string या null,
  "keySymptoms": [strings],
  "duration": string या null,
  "severity": string या null,
  "followUp": [strings],
  "redFlags": [strings],
  "otherRelevantInformation": [strings],
  "informationCompleteness": "limited" | "partial" | "good",
  "summary": string
}`;

export function buildReportSystemPrompt(language: Language): string {
  return language === "hi" ? HINDI_REPORT_SYSTEM_PROMPT : REPORT_SYSTEM_PROMPT;
}

function formatList(items: string[]): string {
  if (items.length === 0) return "none";
  return items.map((item) => `- ${item}`).join("\n");
}

export function buildReportContext(input: HealthReportInput): string {
  const { conversation, collectedData, language } = input;

  const history = conversation
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");

  return `=== LANGUAGE ===
${language === "hi" ? "Hindi - the report text must be in Hindi" : "English"}

=== CONVERSATION TRANSCRIPT ===
${history || "(no messages)"}

=== EXTRACTED HEALTH INFORMATION ===
name: ${collectedData.name ?? "not provided"}
mainConcern: ${collectedData.mainConcern ?? "not provided"}
duration: ${collectedData.duration ?? "not provided"}
severity: ${collectedData.severity ?? "not provided"}
relatedSymptoms:
${formatList(collectedData.relatedSymptoms)}
otherRelevantInformation:
${formatList(collectedData.otherRelevantInformation)}

Generate the health report from this information.`;
}
