import type { CallState } from "../../types/call";
import type { ConversationResponse } from "../../schemas/conversation.schema";
import { getLLMProviders, type LLMProviders } from "./factory";
import type { LLMProvider } from "./provider";
import {
  isTemporaryLLMError,
  type HealthReport,
  type HealthReportInput,
  type ScreeningInput,
} from "./types";

/**
 * Maps application call state to provider-neutral input types. Keeping this
 * mapping here means LLM providers never depend on the call lifecycle.
 */
function toScreeningInput(
  state: CallState,
  latestUserMessage: string,
): ScreeningInput {
  return {
    conversation: state.messages,
    collectedData: state.collectedData,
    askedQuestions: state.askedQuestions,
    latestUserMessage,
    language: state.language,
  };
}

function toHealthReportInput(state: CallState): HealthReportInput {
  return {
    conversation: state.messages,
    collectedData: state.collectedData,
    language: state.language,
  };
}

export interface LLMService {
  generateConversationTurn(
    state: CallState,
    latestUserMessage: string,
  ): Promise<ConversationResponse>;
  generateHealthReport(state: CallState): Promise<HealthReport>;
}

/**
 * Creates the app-facing LLM service with automatic provider fallback:
 * the primary provider is used first; if it fails with a temporary error
 * (rate limit, timeout, server error), the secondary provider takes over.
 * Other errors (auth, invalid responses) propagate immediately.
 */
export function createLLMService(providers: LLMProviders): LLMService {
  const { primary, secondary } = providers;

  async function withFallback<T>(
    run: (provider: LLMProvider) => Promise<T>,
  ): Promise<T> {
    try {
      return await run(primary);
    } catch (error) {
      if (isTemporaryLLMError(error)) {
        console.warn(
          "[LLM] Primary provider unavailable, falling back to secondary",
          error,
        );
        return run(secondary);
      }
      throw error;
    }
  }

  return {
    generateConversationTurn(state, latestUserMessage) {
      const input = toScreeningInput(state, latestUserMessage);
      return withFallback((provider) =>
        provider.generateScreeningResponse(input),
      );
    },
    generateHealthReport(state) {
      const input = toHealthReportInput(state);
      return withFallback((provider) => provider.generateHealthReport(input));
    },
  };
}

export const llmService: LLMService = createLLMService(getLLMProviders());
