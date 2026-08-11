import type { CallState, HealthReport } from "../types/call";
import { generateHealthReport } from "./gemini.service";

/**
 * Local fallback report built purely from collected data.
 * Used when Gemini is unavailable so the call can still finish gracefully.
 */
export function buildLocalReport(state: CallState): HealthReport {
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
      ? `The screening collected ${collectedCount} item${
          collectedCount === 1 ? "" : "s"
        } of health information before ending.`
      : "The screening ended before enough information was collected.";

  return {
    patientName: data.name,
    mainConcern: data.mainConcern,
    keySymptoms: data.relatedSymptoms,
    duration: data.duration,
    severity: data.severity,
    followUp:
      data.mainConcern
        ? ["Consider medical evaluation if symptoms persist or worsen."]
        : [],
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
      const report = await generateHealthReport(state);
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
