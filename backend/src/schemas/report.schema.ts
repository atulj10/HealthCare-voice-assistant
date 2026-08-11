import { z } from "zod";

export const healthReportSchema = z.object({
  patientName: z.string().nullable(),
  mainConcern: z.string().nullable(),
  keySymptoms: z.array(z.string()),
  duration: z.string().nullable(),
  severity: z.string().nullable(),
  followUp: z.array(z.string()),
  redFlags: z.array(z.string()),
  otherRelevantInformation: z.array(z.string()),
  informationCompleteness: z.enum(["limited", "partial", "good"]),
  summary: z.string(),
});

export type HealthReport = z.infer<typeof healthReportSchema>;
