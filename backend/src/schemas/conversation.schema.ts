import { z } from "zod";

export const extractedDataSchema = z.object({
  name: z.string().nullable(),
  mainConcern: z.string().nullable(),
  duration: z.string().nullable(),
  severity: z.string().nullable(),
  relatedSymptoms: z.array(z.string()),
  otherRelevantInformation: z.array(z.string()),
});

export const conversationResponseSchema = z.object({
  reply: z.string().min(1),
  extractedData: extractedDataSchema,
  nextField: z.string().nullable(),
  needsClarification: z.boolean(),
  screeningComplete: z.boolean(),
});

export type ConversationResponse = z.infer<typeof conversationResponseSchema>;
export type ExtractedData = z.infer<typeof extractedDataSchema>;
