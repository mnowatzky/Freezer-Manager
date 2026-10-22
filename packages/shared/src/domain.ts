export const UNITS = ["piece", "portion", "bag", "g", "kg", "ml", "l"] as const;
export type Unit = (typeof UNITS)[number];

/**
 * Fixed food categories (translated in i18n, icons in the web app). `months` is a rough default
 * storage time based on common freezer guidance, used for best-before dates; users override it per food.
 */
export const CATEGORIES = {
  meat: { months: 6 },
  poultry: { months: 8 },
  fish: { months: 4 },
  vegetables: { months: 12 },
  fruit: { months: 10 },
  herbs: { months: 8 },
  baked: { months: 3 },
  meals: { months: 3 },
  soups: { months: 4 },
  dairy: { months: 6 },
  desserts: { months: 3 },
  other: { months: null },
} as const satisfies Record<string, { months: number | null }>;
export type Category = keyof typeof CATEGORIES;
export const CATEGORY_IDS = Object.keys(CATEGORIES) as [Category, ...Category[]];

export const isCategory = (value: unknown): value is Category =>
  typeof value === "string" && Object.hasOwn(CATEGORIES, value);

export const MAX_DRAWERS = 20;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** EAN-8/13, UPC-A/E and GTIN-14: digits only. */
export const BARCODE_PATTERN = /^\d{8,14}$/;
export const barcodeId = (freezerId: string, code: string) => `${freezerId}:${code}`;

/** "750 g", "1,5 l", "33 cl", "2 x 250 g" → a quantity in one of our units; null if not a weight or volume. */
export function parsePackageSize(text: string | null | undefined): { quantity: number; unit: "g" | "kg" | "ml" | "l" } | null {
  const m = /^\s*(?:(\d+)\s*[x×]\s*)?(\d+(?:[.,]\d+)?)\s*(g|kg|ml|cl|l)\b/i.exec(text ?? "");
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  let quantity = count * Number(m[2]!.replace(",", "."));
  let unit = m[3]!.toLowerCase();
  if (unit === "cl") {
    quantity *= 10;
    unit = "ml";
  }
  if (!(quantity > 0)) return null;
  return { quantity: Math.round(quantity * 1000) / 1000, unit: unit as "g" | "kg" | "ml" | "l" };
}

export function suggestionId(freezerId: string, name: string): string {
  return `${freezerId}:${name.trim().toLocaleLowerCase("de")}`;
}

/** Today's date as epoch ms at UTC midnight (Zero's representation of a Postgres `date`). */
export function todayAsDate(now = new Date()): number {
  return Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
}

export const DAY_MS = 86_400_000;

/** Items whose best-before date is at most this many days away count as "eat soon". */
export const EAT_SOON_DAYS = 7;

/** Adds calendar months to a date (epoch ms at UTC midnight), clamping to the month's last day (Jan 31 + 1 → Feb 28). */
export function addMonths(date: number, months: number): number {
  const d = new Date(date);
  const target = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1);
  const t = new Date(target);
  const lastDay = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(d.getUTCDate(), lastDay));
}

/** Whole calendar months from `from` to `to`, rounded to the nearest month and at least 1. */
export function monthsBetween(from: number, to: number): number {
  const a = new Date(from);
  const b = new Date(to);
  const whole = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + b.getUTCMonth() - a.getUTCMonth();
  // Round by comparing against the two nearest candidates.
  const candidates = [whole - 1, whole, whole + 1];
  const best = candidates.reduce((x, y) => (Math.abs(addMonths(from, y) - to) < Math.abs(addMonths(from, x) - to) ? y : x));
  return Math.max(1, best);
}

/**
 * Storage time for a food: the months remembered for it (set when someone changed a best-before date
 * by hand), else the category's default, else none (no best-before date, no warning).
 */
export function shelfLifeMonths(remembered: number | null | undefined, category: string | null | undefined): number | null {
  if (remembered) return remembered;
  return isCategory(category) ? CATEGORIES[category].months : null;
}

export function defaultBestBefore(frozenAt: number, months: number | null): number | null {
  return months ? addMonths(frozenAt, months) : null;
}

export type Freshness = "ok" | "soon" | "expired";

/** "soon": due within EAT_SOON_DAYS (including today); "expired": the date has passed. */
export function freshness(bestBefore: number | null, today: number): Freshness {
  if (bestBefore === null) return "ok";
  if (bestBefore < today) return "expired";
  return bestBefore - today <= EAT_SOON_DAYS * DAY_MS ? "soon" : "ok";
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
