import type {
  HealthReport,
  HealthReportInput,
  ScreeningInput,
  ScreeningResponse,
} from "./types";

/**
 * The only interface the rest of the backend depends on.
 * Implementations (Gemini, Cerebras, ...) must normalize their responses and
 * errors into the application-level types defined in ./types.ts.
 */
export interface LLMProvider {
  generateScreeningResponse(input: ScreeningInput): Promise<ScreeningResponse>;
  generateHealthReport(input: HealthReportInput): Promise<HealthReport>;
}
