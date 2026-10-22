import { DAY_MS, todayAsDate, type Unit } from "@freezer/shared/domain";
import { formatLocale, t } from "./i18n";

const DAY = 86_400_000;

export function ageLabel(frozenAt: number) {
  return t.item.age(Math.max(0, Math.floor((todayAsDate() - frozenAt) / DAY)));
}

/** "in 5 days", "2 weeks over", … */
export function bestBeforeLabel(bestBefore: number) {
  return t.item.bestBeforeRelative(Math.round((bestBefore - todayAsDate()) / DAY_MS));
}

export function quantityLabel(quantity: number, unit: string) {
  const n = quantity.toLocaleString(formatLocale, { maximumFractionDigits: 3 });
  return `${n} ${t.units[unit as Unit]?.(quantity) ?? unit}`;
}

/** Zero `date` (epoch ms, UTC midnight) <-> <input type="date"> value. */
export const dateToInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const inputToDate = (value: string) => Date.parse(`${value}T00:00:00Z`);

export const formatDate = (ms: number) => new Date(ms).toLocaleDateString(formatLocale);
