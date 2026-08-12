import { env, type Env } from "../../config/env";
import type { LLMProvider } from "./provider";
import { GeminiProvider } from "./gemini.provider";
import { CerebrasProvider } from "./cerebras.provider";

export interface LLMProviders {
  primary: LLMProvider;
  secondary: LLMProvider;
}

/**
 * Registry of every known provider. Names come from the
 * `LLM_PROVIDER` / `LLM_FALLBACK_PROVIDER` environment variables.
 */
const PROVIDER_REGISTRY = {
  gemini: (e: Env) => new GeminiProvider(e),
  cerebras: (e: Env) => new CerebrasProvider(e),
} as const satisfies Record<string, (e: Env) => LLMProvider>;

export type LLMProviderName = keyof typeof PROVIDER_REGISTRY;

function resolveProviderName(
  name: string | undefined,
  fallback: LLMProviderName,
): LLMProviderName {
  return name && name in PROVIDER_REGISTRY ? (name as LLMProviderName) : fallback;
}

/**
 * Primary and secondary providers wired from environment config.
 * Gemini is the primary by default; Cerebras is the automatic fallback.
 */
export function getLLMProviders(): LLMProviders {
  const primaryName = resolveProviderName(env.LLM_PROVIDER, "gemini");
  const secondaryName = resolveProviderName(
    env.LLM_FALLBACK_PROVIDER,
    "cerebras",
  );

  if (primaryName !== env.LLM_PROVIDER) {
    console.warn(
      `[LLM] Unknown primary provider "${env.LLM_PROVIDER}", using "${primaryName}".`,
    );
  }
  if (secondaryName !== env.LLM_FALLBACK_PROVIDER) {
    console.warn(
      `[LLM] Unknown fallback provider "${env.LLM_FALLBACK_PROVIDER}", using "${secondaryName}".`,
    );
  }

  return {
    primary: PROVIDER_REGISTRY[primaryName](env),
    secondary: PROVIDER_REGISTRY[secondaryName](env),
  };
}
