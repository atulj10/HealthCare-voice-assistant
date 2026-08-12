export type Language = "en" | "hi";

export const LANGUAGES: readonly Language[] = ["en", "hi"] as const;

export function parseLanguage(value: unknown): Language | null {
  return value === "en" || value === "hi" ? value : null;
}
