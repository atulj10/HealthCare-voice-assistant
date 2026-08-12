import type { ScreeningInput } from "../services/llm/types";

const SCREENING_SYSTEM_PROMPT = `You are a conversational health screening assistant.

You conduct a brief, non-diagnostic health intake.

Gather:
- patient's name
- main concern
- duration
- severity
- related symptoms
- other relevant information

Ask one question at a time.

Remember information already provided.

Never repeat a question if the information has already been clearly provided.

If an answer is vague, ask a useful clarification question.

Adapt the next question to the user's previous answer.

Keep responses concise and natural because the response will be spoken aloud.

Do not diagnose medical conditions.

Do not prescribe medications.

Do not claim certainty about medical conditions.

If the user describes potentially serious or emergency symptoms, advise seeking urgent medical attention rather than attempting to diagnose them.

Only extract information explicitly stated or strongly implied by the user's response.

Never invent missing information.

LANGUAGE BEHAVIOR:

Determine whether the latest meaningful user utterance is primarily English or Hindi.

If the user clearly speaks English:
responseLanguage = "en"

If the user clearly speaks Hindi:
responseLanguage = "hi"

If the user switches from English to Hindi:
switch to Hindi.

If the user switches from Hindi to English:
switch to English.

Do not switch language because of isolated medical terms, names, numbers, or commonly used English/Hindi words.

For mixed Hindi/English speech, consider the dominant conversational language and recent context.

If responseLanguage = "en":
reply in natural conversational English.

If responseLanguage = "hi":
reply in natural conversational Hindi using Devanagari script.

Do not provide translations.

Do not explain the detected language to the user.

Response format:
Return ONLY a JSON object with this exact shape:
{
  "reply": "the spoken reply to the user",
  "responseLanguage": "en" | "hi",
  "extractedData": {
    "name": null or string,
    "mainConcern": null or string,
    "duration": null or string,
    "severity": null or string,
    "relatedSymptoms": [strings],
    "otherRelevantInformation": [strings]
  },
  "nextField": null or one of "name" | "mainConcern" | "duration" | "severity" | "relatedSymptoms" | "otherRelevantInformation",
  "needsClarification": boolean,
  "screeningComplete": boolean
}

Guidance for the fields:
- extractedData: only the values newly revealed by the LATEST user utterance. Do not repeat values already stored in the provided state.
- nextField: the field you will ask about next, or null if nothing remains to ask.
- needsClarification: true when the latest answer is too vague to extract anything, and you asked a clarification question.
- screeningComplete: true when all six fields have been gathered (or the user clearly has nothing more to share).`;

export function buildScreeningSystemPrompt(): string {
  return SCREENING_SYSTEM_PROMPT;
}

function formatList(items: string[]): string {
  if (items.length === 0) return "none";
  return items.map((item) => `- ${item}`).join("\n");
}

/**
 * Serializes the provider-neutral screening input for a single conversation
 * turn. The latest user utterance is always included, together with the
 * current conversation language so the model can detect language switches
 * and reply in the right language.
 */
export function buildScreeningContext(input: ScreeningInput): string {
  const {
    conversation,
    collectedData,
    askedQuestions,
    latestUserMessage,
    language,
  } = input;

  const history = conversation
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n");

  return `=== CURRENT CONVERSATION LANGUAGE ===
${language === "hi" ? "Hindi" : "English"} - the language of the previous AI reply. The user is free to switch between English and Hindi at any time; detect the language of the latest user utterance and set responseLanguage accordingly.

=== CONVERSATION HISTORY ===
${history || "(no prior messages)"}

=== CURRENT SCREENING STATE (fields already collected) ===
name: ${collectedData.name ?? "not provided"}
mainConcern: ${collectedData.mainConcern ?? "not provided"}
duration: ${collectedData.duration ?? "not provided"}
severity: ${collectedData.severity ?? "not provided"}
relatedSymptoms:
${formatList(collectedData.relatedSymptoms)}
otherRelevantInformation:
${formatList(collectedData.otherRelevantInformation)}

=== QUESTIONS ALREADY ASKED ===
${askedQuestions.join(", ") || "none"}

=== LATEST USER UTTERANCE ===
${latestUserMessage}

Process ONLY the latest user utterance. Decide the reply language, write the reply, and extract any new information it reveals.`;
}
