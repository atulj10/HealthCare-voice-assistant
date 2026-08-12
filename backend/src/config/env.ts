import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  BACKEND_PORT: z.coerce.number().int().positive().default(5000),
  FRONTEND_URL: z.string().url().default("http://localhost:5173"),

  /* LLM provider selection (primary + automatic fallback) */
  LLM_PROVIDER: z.enum(["gemini", "cerebras"]).default("gemini"),
  LLM_FALLBACK_PROVIDER: z.enum(["gemini", "cerebras"]).default("cerebras"),

  /* Deepgram streaming STT */
  DEEPGRAM_API_KEY: z.string().optional(),
  DEEPGRAM_STT_MODEL: z.string().default("nova-3"),
  DEEPGRAM_STT_LANGUAGE: z.string().default("multi"),

  /* Gemini (primary LLM) */
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().default("gemini-3.6-flash"),

  /* Cerebras (fallback LLM) */
  CEREBRAS_API_KEY: z.string().optional(),
  CEREBRAS_MODEL: z.string().default("gpt-oss-120b"),

  /* ElevenLabs TTS */
  ELEVENLABS_API_KEY: z.string().optional(),
  ELEVENLABS_MODEL_ID: z.string().default("eleven_flash_v2_5"),
  ELEVENLABS_VOICE_EN: z.string().optional(),
  ELEVENLABS_VOICE_HI: z.string().optional(),
  ELEVENLABS_BASE_URL: z.string().url().default("https://api.elevenlabs.io"),
  ELEVENLABS_OPTIMIZE_STREAMING_LATENCY: z.coerce
    .number()
    .int()
    .min(0)
    .max(4)
    .default(1),

  /* Shared audio pipeline sample rate (mic capture, STT, browser playback) */
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
export type Env = z.infer<typeof envSchema>;

const missingKeys = (
  [
    ["DEEPGRAM_API_KEY", env.DEEPGRAM_API_KEY],
    ["GEMINI_API_KEY", env.GEMINI_API_KEY],
    ["CEREBRAS_API_KEY", env.CEREBRAS_API_KEY],
    ["ELEVENLABS_API_KEY", env.ELEVENLABS_API_KEY],
  ] as const
).filter(([, value]) => !value);

if (missingKeys.length > 0) {
  console.warn(
    `[ENV] Missing API key${missingKeys.length > 1 ? "s" : ""}: ${missingKeys
      .map(([name]) => name)
      .join(", ")}. Add them to backend/.env before testing the voice pipeline.`,
  );
}
