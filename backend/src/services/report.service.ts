import type { CallState, HealthReport } from "../types/call";
import { llmService } from "./llm/llm.service";

const LOCAL_SUMMARY = {
  en: (count: number) =>
    `The screening collected ${count} item${count === 1 ? "" : "s"} of health information before ending.`,
  hi: (count: number) =>
    `स्क्रीनिंग समाप्त होने से पहले स्वास्थ्य जानकारी की ${count} आइटम एकत्र की गईं।`,
};

const LOCAL_ENDED_EARLY = {
  en: "The screening ended before enough information was collected.",
  hi: "पर्याप्त जानकारी एकत्र होने से पहले स्क्रीनिंग समाप्त हो गई।",
};

const LOCAL_FOLLOW_UP = {
  en: "Consider medical evaluation if symptoms persist or worsen.",
  hi: "यदि लक्षण बने रहें या बढ़ें तो चिकित्सीय मूल्यांकन पर विचार करें।",
};

/**
 * Local fallback report built purely from collected data.
 * Used when Gemini is unavailable so the call can still finish gracefully.
 */
export function buildLocalReport(state: CallState): HealthReport {
  const language = state.language;
  const data = state.collectedData;
  const collectedCount = [
    data.name,
    data.mainConcern,
    data.duration,
    data.severity,
    ...data.relatedSymptoms,
    ...data.otherRelevantInformation,
  ].filter((value) => value && value.trim().length > 0).length;

  const informationCompleteness: HealthReport["informationCompleteness"] =
    collectedCount >= 5 ? "good" : collectedCount >= 2 ? "partial" : "limited";

  const summary =
    collectedCount > 0
      ? LOCAL_SUMMARY[language](collectedCount)
      : LOCAL_ENDED_EARLY[language];

  return {
    patientName: data.name,
    mainConcern: data.mainConcern,
    keySymptoms: data.relatedSymptoms,
    duration: data.duration,
    severity: data.severity,
    followUp: data.mainConcern ? [LOCAL_FOLLOW_UP[language]] : [],
    redFlags: [],
    otherRelevantInformation: data.otherRelevantInformation,
    informationCompleteness,
    summary,
  };
}

const reportLocks = new Map<string, Promise<HealthReport>>();

export async function generateReport(state: CallState): Promise<HealthReport> {
  if (state.report) return state.report;

  const inFlight = reportLocks.get(state.callId);
  if (inFlight) return inFlight;

  const promise = (async (): Promise<HealthReport> => {
    try {
      console.log("[CALL] Generating report");
      const report = await llmService.generateHealthReport(state);
      console.log("[CALL] Report generated");
      return report;
    } catch (error) {
      console.error("[CALL] Gemini report generation failed, using fallback", error);
      return buildLocalReport(state);
    }
  })();

  reportLocks.set(state.callId, promise);

  try {
    const report = await promise;
    state.report = report;
    return report;
  } finally {
    reportLocks.delete(state.callId);
  }
}
