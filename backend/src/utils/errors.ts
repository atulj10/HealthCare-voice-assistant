/**
 * Extracts a readable message from unknown error values, including the
 * non-Error event objects emitted by the Deepgram SDK (whose `error` field
 * usually holds the underlying Error).
 */
export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    const candidate = error as { message?: unknown; error?: unknown };
    if (typeof candidate.message === "string" && candidate.message) {
      return candidate.message;
    }
    if (candidate.error !== undefined) {
      return toErrorMessage(candidate.error);
    }
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}
