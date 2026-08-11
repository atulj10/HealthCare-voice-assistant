import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),
  DEEPGRAM_API_KEY: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  DEEPGRAM_STT_MODEL: z.string().default("nova-3"),
  DEEPGRAM_TTS_MODEL: z.string().default("aura-2-luna-en"),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),
  TTS_SAMPLE_RATE: z.coerce.number().int().positive().default(16000),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error("[ENV] Invalid environment configuration:");
  for (const issue of parsed.error.issues) {
    console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;

const missingKeys = (
  [
    ["DEEPGRAM_API_KEY", env.DEEPGRAM_API_KEY],
    ["GEMINI_API_KEY", env.GEMINI_API_KEY],
  ] as const
).filter(([, value]) => !value);

if (missingKeys.length > 0) {
  console.warn(
    `[ENV] Missing API key${missingKeys.length > 1 ? "s" : ""}: ${missingKeys
      .map(([name]) => name)
      .join(", ")}. Add them to backend/.env before testing the voice pipeline.`,
  );
}
