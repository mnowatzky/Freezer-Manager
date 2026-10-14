import { todayAsDate, type Unit } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";

const DAY = 86_400_000;

export function ageLabel(frozenAt: number) {
  return de.item.age(Math.max(0, Math.floor((todayAsDate() - frozenAt) / DAY)));
}

export function quantityLabel(quantity: number, unit: string) {
  const n = quantity.toLocaleString("de-DE", { maximumFractionDigits: 3 });
  return `${n} ${de.units[unit as Unit] ?? unit}`;
}

/** Zero `date` (epoch ms, UTC midnight) <-> <input type="date"> value. */
export const dateToInput = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const inputToDate = (value: string) => Date.parse(`${value}T00:00:00Z`);

export const formatDate = (ms: number) => new Date(ms).toLocaleDateString("de-DE");
