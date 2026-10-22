import { z } from "zod";
import { CATEGORY_IDS, MAX_DRAWERS, todayAsDate, UNITS, type Category, type Unit } from "./domain";
import * as field from "./fields";
import { LOCALES, messages, type Locale } from "./i18n";

// Export and import of a freezer's contents. Export happens entirely on the client (it already has
// the whole freezer from Zero). Import parses and validates on the client (preview), then sends
// the rows to the freezer.import mutator in chunks of at most MAX_IMPORT_ITEMS.

export const MAX_IMPORT_ITEMS = 1000;

// ---------------------------------------------------------------------------
// Mutator arguments
// ---------------------------------------------------------------------------

export const importItem = z.object({
  id: field.id,
  name: field.name,
  quantity: field.quantity,
  unit: field.unit,
  category: field.category,
  /** Drawer name; matched case-insensitively, created if missing. Empty = the freezer's first drawer. */
  drawer: z.string().trim().max(100),
  containerNumber: field.containerNumber,
  frozenAt: field.date,
  /** undefined (column missing) = the food's default, like freezing in the app; null = no date. */
  bestBefore: field.date.nullable().optional(),
  notes: field.notes,
});
export const importSuggestion = z.object({
  name: field.name,
  lastUnit: field.unit,
  lastCategory: field.category,
  shelfLifeMonths: field.shelfLifeMonths,
  useCount: z.number().int().min(0).max(1_000_000),
});
export const importBarcode = z.object({
  code: field.barcode,
  name: field.name,
  quantity: field.quantity,
  unit: field.unit,
  category: field.category,
});
export const importArgs = z.object({
  freezerId: field.id,
  /** Drawer names in order; missing ones are created (up to MAX_DRAWERS) with `newDrawerIds`. */
  drawers: z.array(z.string().trim().min(1).max(100)).max(MAX_IMPORT_ITEMS),
  newDrawerIds: z.array(field.id).max(MAX_DRAWERS),
  items: z.array(importItem).max(MAX_IMPORT_ITEMS),
  /** From a JSON export. Without them, the item names become suggestions. */
  suggestions: z.array(importSuggestion).max(MAX_IMPORT_ITEMS).optional(),
  barcodes: z.array(importBarcode).max(MAX_IMPORT_ITEMS).optional(),
});

export type ImportItem = z.infer<typeof importItem>;
export type ImportArgs = z.infer<typeof importArgs>;
export type ParsedItem = Omit<ImportItem, "id">;

// ---------------------------------------------------------------------------
// Planning, shared by the preview and the mutator so both come to the same result
// ---------------------------------------------------------------------------

export const drawerKey = (name: string) => name.trim().toLocaleLowerCase("de");

/** Which drawer names have to be created, and which can't be because the freezer is full. */
export function planDrawers(existing: readonly string[], wanted: readonly string[]) {
  const known = new Set(existing.map(drawerKey));
  const create: string[] = [];
  const overLimit: string[] = [];
  for (const name of wanted) {
    const key = drawerKey(name);
    if (!key || known.has(key)) continue;
    known.add(key);
    if (existing.length + create.length < MAX_DRAWERS) create.push(name.trim());
    else overLimit.push(name.trim());
  }
  return { create, overLimit };
}

/** Container numbers that are taken (by the freezer, or earlier in the file) lose their number. */
export function containerConflicts(used: Iterable<number | null>, items: readonly { containerNumber: number | null }[]) {
  const taken = new Set<number>();
  for (const n of used) if (n !== null) taken.add(n);
  const conflicts: number[] = [];
  for (const item of items) {
    const n = item.containerNumber;
    if (n === null) continue;
    if (taken.has(n)) conflicts.push(n);
    else taken.add(n);
  }
  return conflicts;
}

/** Splits an import into mutator calls of at most MAX_IMPORT_ITEMS rows each; drawers go with the first. */
export function chunkImport(args: ImportArgs): ImportArgs[] {
  const chunks: ImportArgs[] = [];
  const count = Math.max(1, Math.ceil(Math.max(args.items.length, args.suggestions?.length ?? 0, args.barcodes?.length ?? 0) / MAX_IMPORT_ITEMS));
  for (let i = 0; i < count; i++) {
    const slice = <T>(list: T[]) => list.slice(i * MAX_IMPORT_ITEMS, (i + 1) * MAX_IMPORT_ITEMS);
    chunks.push({
      freezerId: args.freezerId,
      drawers: i === 0 ? args.drawers : [],
      newDrawerIds: i === 0 ? args.newDrawerIds : [],
      items: slice(args.items),
      ...(args.suggestions ? { suggestions: slice(args.suggestions) } : {}),
      ...(args.barcodes ? { barcodes: slice(args.barcodes) } : {}),
    });
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export type ExportSource = {
  name: string;
  drawers: readonly { id: string; name: string; sortOrder: number }[];
  items: readonly {
    name: string;
    quantity: number;
    unit: string;
    category: string | null;
    drawerId: string;
    containerNumber: number | null;
    frozenAt: number;
    bestBefore: number | null;
    notes: string | null;
  }[];
  suggestions: readonly { name: string; lastUnit: string; lastCategory: string | null; shelfLifeMonths: number | null; useCount: number }[];
  barcodes: readonly { code: string; name: string; quantity: number; unit: string; category: string | null }[];
};

export type ExportFile = {
  format: "freezer-manager";
  version: 1;
  exportedAt: string;
  freezer: { name: string };
  drawers: { name: string }[];
  items: {
    name: string;
    quantity: number;
    unit: string;
    category: string | null;
    drawer: string;
    containerNumber: number | null;
    frozenAt: string;
    bestBefore: string | null;
    notes: string | null;
  }[];
  suggestions: ExportSource["suggestions"][number][];
  barcodes: ExportSource["barcodes"][number][];
};

export function buildExport(freezer: ExportSource, now = new Date()): ExportFile {
  const drawers = [...freezer.drawers].sort((a, b) => a.sortOrder - b.sortOrder);
  const drawerName = new Map(drawers.map((d) => [d.id, d.name]));
  return {
    format: "freezer-manager",
    version: 1,
    exportedAt: now.toISOString(),
    freezer: { name: freezer.name },
    drawers: drawers.map((d) => ({ name: d.name })),
    items: freezer.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unit: i.unit,
      category: i.category,
      drawer: drawerName.get(i.drawerId) ?? "",
      containerNumber: i.containerNumber,
      frozenAt: isoDate(i.frozenAt),
      bestBefore: i.bestBefore === null ? null : isoDate(i.bestBefore),
      notes: i.notes,
    })),
    suggestions: freezer.suggestions.map(({ name, lastUnit, lastCategory, shelfLifeMonths, useCount }) => ({
      name,
      lastUnit,
      lastCategory,
      shelfLifeMonths,
      useCount,
    })),
    barcodes: freezer.barcodes.map(({ code, name, quantity, unit, category }) => ({ code, name, quantity, unit, category })),
  };
}

export const CSV_COLUMNS = ["name", "quantity", "unit", "category", "drawer", "container", "frozen_at", "best_before", "notes"] as const;

/**
 * One row per item. German: `;` as separator and decimal commas, so Excel opens it as a table.
 * UTF-8 with a BOM, so Excel gets the umlauts right.
 */
const csvCell = (value: string, sep: string) =>
  value.includes(sep) || /["\r\n]/.test(value) || value !== value.trim() ? `"${value.replace(/"/g, '""')}"` : value;

export function toCsv(file: ExportFile, locale: Locale): string {
  const sep = locale === "de" ? ";" : ",";
  const num = (n: number) => (locale === "de" ? String(n).replace(".", ",") : String(n));
  const rows = file.items.map((i) =>
    [i.name, num(i.quantity), i.unit, i.category ?? "", i.drawer, i.containerNumber?.toString() ?? "", i.frozenAt, i.bestBefore ?? "", i.notes ?? ""]
      .map((v) => csvCell(v, sep))
      .join(sep),
  );
  return `﻿${[CSV_COLUMNS.join(sep), ...rows].join("\r\n")}\r\n`;
}

// ---------------------------------------------------------------------------
// Import parsing
// ---------------------------------------------------------------------------

/** RFC 4180: quoted fields may contain separators, quotes ("") and line breaks. */
export function parseCsv(text: string, sep: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"' && value === "") quoted = true;
    else if (c === sep) {
      row.push(value);
      value = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value !== "" || row.length) {
    row.push(value);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ""));
}

export type SkipReason = "name" | "quantity" | "unit" | "date" | "container" | "invalid";

export type ParsedImport = {
  kind: "json" | "csv";
  /** Freezer name from a JSON export (lets it be imported as a new freezer). */
  freezerName: string | null;
  drawers: string[];
  items: ParsedItem[];
  suggestions?: z.infer<typeof importSuggestion>[];
  barcodes?: z.infer<typeof importBarcode>[];
  /** Rows that can't be imported (1-based line numbers for CSV, item numbers for JSON). */
  skipped: { row: number; reason: SkipReason }[];
};

export class ImportFormatError extends Error {}

// Units and categories by id or by their English/German label ("Stück", "Portionen", "Fleisch", …).
const unitNames = new Map<string, Unit>();
const categoryNames = new Map<string, Category>();
for (const u of UNITS) {
  unitNames.set(u, u);
  for (const l of LOCALES) for (const n of [1, 2]) unitNames.set(messages[l].units[u](n).toLowerCase(), u);
}
for (const c of CATEGORY_IDS) {
  categoryNames.set(c, c);
  for (const l of LOCALES) categoryNames.set(messages[l].categories[c].toLowerCase(), c);
}

/** ISO (2026-10-22) or German (22.10.2026) date → epoch ms at UTC midnight. */
export function parseDate(text: string): number | null {
  const s = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  const german = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(s);
  let y: number, mo: number, d: number;
  if (iso) [y, mo, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (german) [d, mo, y] = [Number(german[1]), Number(german[2]), Number(german[3])];
  else return null;
  const ms = Date.UTC(y, mo - 1, d);
  const check = new Date(ms);
  return check.getUTCFullYear() === y && check.getUTCMonth() === mo - 1 && check.getUTCDate() === d ? ms : null;
}

function parseNumber(text: string): number {
  return Number(text.trim().replace(/\s/g, "").replace(",", "."));
}

type RawItem = {
  name: string;
  quantity: string | number;
  unit: string;
  category: string;
  drawer: string;
  container: string | number | null;
  frozenAt: string;
  bestBefore: string | null | undefined;
  notes: string;
};

function toItem(raw: RawItem, today: number): ParsedItem | SkipReason {
  const name = field.name.safeParse(raw.name);
  if (!name.success) return "name";
  const quantity = field.quantity.safeParse(typeof raw.quantity === "number" ? raw.quantity : parseNumber(raw.quantity || "1"));
  if (!quantity.success) return "quantity";
  const unit = raw.unit.trim() ? unitNames.get(raw.unit.trim().toLowerCase()) : "piece";
  if (!unit) return "unit";
  const containerText = raw.container === null ? "" : String(raw.container).trim();
  const container = containerText ? field.containerNumber.safeParse(Number(containerText)) : { success: true as const, data: null };
  if (!container.success) return "container";
  const frozenAt = raw.frozenAt.trim() ? parseDate(raw.frozenAt) : today;
  if (frozenAt === null) return "date";
  let bestBefore: number | null | undefined;
  if (raw.bestBefore !== undefined) {
    bestBefore = raw.bestBefore?.trim() ? parseDate(raw.bestBefore) : null;
    if (raw.bestBefore?.trim() && bestBefore === null) return "date";
  }
  const category = categoryNames.get(raw.category.trim().toLowerCase()) ?? null;
  return {
    name: name.data,
    quantity: quantity.data,
    unit,
    category,
    drawer: raw.drawer.trim().slice(0, 100),
    containerNumber: container.data,
    frozenAt,
    bestBefore,
    notes: raw.notes.trim().slice(0, 500) || null,
  };
}

function collect(raws: RawItem[], rowNumber: (i: number) => number, today: number) {
  const items: ParsedItem[] = [];
  const skipped: ParsedImport["skipped"] = [];
  raws.forEach((raw, i) => {
    const result = toItem(raw, today);
    if (typeof result === "string") skipped.push({ row: rowNumber(i), reason: result });
    else items.push(result);
  });
  return { items, skipped };
}

function parseCsvImport(text: string, today: number): ParsedImport {
  const content = text.replace(/^﻿/, "");
  const firstLine = content.split(/\r?\n/, 1)[0] ?? "";
  const sep = [";", "\t", ","].find((s) => firstLine.includes(s)) ?? ",";
  const [header, ...rows] = parseCsv(content, sep);
  const columns = (header ?? []).map((h) => h.trim().toLowerCase());
  const col = (name: (typeof CSV_COLUMNS)[number]) => columns.indexOf(name);
  if (col("name") < 0) throw new ImportFormatError("missing name column");
  const get = (row: string[], name: (typeof CSV_COLUMNS)[number]) => (col(name) >= 0 ? (row[col(name)] ?? "") : "");
  const hasBestBefore = col("best_before") >= 0;
  const raws = rows.map((row) => ({
    name: get(row, "name"),
    quantity: get(row, "quantity"),
    unit: get(row, "unit"),
    category: get(row, "category"),
    drawer: get(row, "drawer"),
    container: get(row, "container"),
    frozenAt: get(row, "frozen_at"),
    bestBefore: hasBestBefore ? get(row, "best_before") : undefined,
    notes: get(row, "notes"),
  }));
  const { items, skipped } = collect(raws, (i) => i + 2, today);
  const drawers = [...new Set(items.map((i) => i.drawer).filter(Boolean))];
  return { kind: "csv", freezerName: null, drawers, items, skipped };
}

const exportFileSchema = z.object({
  format: z.literal("freezer-manager"),
  version: z.literal(1),
  freezer: z.object({ name: z.string() }),
  drawers: z.array(z.object({ name: z.string() })),
  items: z.array(z.record(z.string(), z.unknown())),
  suggestions: z.array(z.unknown()).optional(),
  barcodes: z.array(z.unknown()).optional(),
});

const str = (v: unknown) => (typeof v === "string" ? v : "");
const validEntries = <T>(schema: z.ZodType<T>, list: unknown[] | undefined) =>
  (list ?? []).flatMap((entry) => {
    const parsed = schema.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });

function parseJsonImport(text: string, today: number): ParsedImport {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new ImportFormatError("not JSON");
  }
  const file = exportFileSchema.safeParse(json);
  if (!file.success) throw new ImportFormatError("not a Freezer Manager export");
  const raws = file.data.items.map((i) => ({
    name: str(i.name),
    quantity: typeof i.quantity === "number" ? i.quantity : str(i.quantity),
    unit: str(i.unit),
    category: str(i.category),
    drawer: str(i.drawer),
    container: typeof i.containerNumber === "number" ? i.containerNumber : null,
    frozenAt: str(i.frozenAt),
    bestBefore: i.bestBefore === null ? null : str(i.bestBefore),
    notes: str(i.notes),
  }));
  const { items, skipped } = collect(raws, (i) => i + 1, today);
  const drawerNames = file.data.drawers.map((d) => d.name.trim()).filter(Boolean);
  return {
    kind: "json",
    freezerName: field.name.safeParse(file.data.freezer.name).data ?? null,
    drawers: [...new Set([...drawerNames, ...items.map((i) => i.drawer).filter(Boolean)])],
    items,
    suggestions: validEntries(importSuggestion, file.data.suggestions),
    barcodes: validEntries(importBarcode, file.data.barcodes),
    skipped,
  };
}

/** Parses an exported JSON file or a CSV (ours, or a spreadsheet with the same column names). */
export function parseImport(text: string, { today = todayAsDate() }: { today?: number } = {}): ParsedImport {
  return text.trimStart().replace(/^﻿/, "").startsWith("{") ? parseJsonImport(text, today) : parseCsvImport(text, today);
}

