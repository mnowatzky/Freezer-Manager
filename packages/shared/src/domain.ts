export const UNITS = ["piece", "portion", "bag", "g", "kg", "ml", "l"] as const;
export type Unit = (typeof UNITS)[number];

export const MAX_DRAWERS = 20;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function suggestionId(freezerId: string, name: string): string {
  return `${freezerId}:${name.trim().toLocaleLowerCase("de")}`;
}

/** Today's date as epoch ms at UTC midnight (Zero's representation of a Postgres `date`). */
export function todayAsDate(now = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * Extracts a container number from scanned QR text.
 * Stickers encode `https://<host>/c/<number>`; a bare number is accepted as a fallback.
 */
export function parseContainerCode(text: string): number | null {
  const trimmed = text.trim();
  const match = /^(?:\d+)$/.test(trimmed) ? trimmed : /\/c\/(\d+)\/?(?:[?#].*)?$/.exec(trimmed)?.[1];
  if (!match) return null;
  const n = Number(match);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function containerUrl(origin: string, number: number): string {
  return `${origin.replace(/\/$/, "")}/c/${number}`;
}
