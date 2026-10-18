import { ApplicationError } from "@rocicorp/zero";
import { de, type Messages } from "./de";
import { en } from "./en";

export { de, en, type Messages };

export const LOCALES = ["en", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const messages: Record<Locale, Messages> = { en, de };

/** Picks the first supported language from the browser's preference list; English otherwise. */
export function pickLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const lang = tag.toLowerCase().split("-")[0] ?? "";
    if ((LOCALES as readonly string[]).includes(lang)) return lang as Locale;
  }
  return "en";
}

// Mutator errors are thrown on the server too, where the user's language is unknown. They carry a
// code in `details`, and the client shows the message in its own language (see errorMessage).
type ErrorParams = { [K in keyof Messages["errors"]]: Messages["errors"][K] extends (n: number) => string ? [n: number] : [] };
export type ErrorCode = keyof ErrorParams;
type ErrorDetails = { code: ErrorCode; params: number[] };

export function appError<C extends ErrorCode>(code: C, ...params: ErrorParams[C]) {
  const message = en.errors[code];
  const details: ErrorDetails = { code, params };
  return new ApplicationError(typeof message === "function" ? message(params[0]!) : message, { details });
}

/** Localized text for a mutator error; falls back to the raw message (e.g. a validation error). */
export function errorMessage(t: Messages, error: { message: string; details?: unknown }): string {
  const details = error.details as Partial<ErrorDetails> | undefined;
  const code = details?.code;
  if (!code || !(code in t.errors)) return error.message;
  const message = t.errors[code];
  return typeof message === "function" ? message(details.params?.[0] ?? 0) : message;
}
