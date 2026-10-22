import { describe, expect, it } from "vitest";
import {
  buildExport,
  chunkImport,
  containerConflicts,
  MAX_IMPORT_ITEMS,
  parseCsv,
  parseDate,
  parseImport,
  planDrawers,
  toCsv,
  type ExportSource,
  type ImportArgs,
} from "../src/import";
import { MAX_DRAWERS } from "../src/domain";

const d = (iso: string) => Date.parse(`${iso}T00:00:00Z`);
const TODAY = d("2026-10-22");

const source: ExportSource = {
  name: "Keller",
  drawers: [
    { id: "d2", name: "Unten", sortOrder: 1 },
    { id: "d1", name: "Oben", sortOrder: 0 },
  ],
  items: [
    { name: 'Chili "scharf", vegan', quantity: 1.5, unit: "l", category: "meals", drawerId: "d1", containerNumber: 3, frozenAt: d("2026-09-01"), bestBefore: d("2026-12-01"), notes: "Zeile 1\nZeile 2; mit Semikolon" },
    { name: "Erbsen", quantity: 450, unit: "g", category: null, drawerId: "d2", containerNumber: null, frozenAt: d("2026-08-15"), bestBefore: null, notes: null },
  ],
  suggestions: [{ name: "Erbsen", lastUnit: "g", lastCategory: "vegetables", shelfLifeMonths: 10, useCount: 3 }],
  barcodes: [{ code: "4001234567890", name: "Erbsen", quantity: 450, unit: "g", category: "vegetables" }],
};

describe("CSV", () => {
  it("round-trips quotes, separators, line breaks and decimal commas (German)", () => {
    const csv = toCsv(buildExport(source), "de");
    expect(csv.startsWith("﻿name;quantity;unit;category;drawer;container;frozen_at;best_before;notes\r\n")).toBe(true);
    expect(csv).toContain('"Chili ""scharf"", vegan";1,5;l;meals;Oben;3;2026-09-01;2026-12-01;"Zeile 1\nZeile 2; mit Semikolon"');
    const parsed = parseImport(csv, { today: TODAY });
    expect(parsed.skipped).toEqual([]);
    expect(parsed.drawers).toEqual(["Oben", "Unten"]);
    expect(parsed.items).toEqual([
      { name: 'Chili "scharf", vegan', quantity: 1.5, unit: "l", category: "meals", drawer: "Oben", containerNumber: 3, frozenAt: d("2026-09-01"), bestBefore: d("2026-12-01"), notes: "Zeile 1\nZeile 2; mit Semikolon" },
      { name: "Erbsen", quantity: 450, unit: "g", category: null, drawer: "Unten", containerNumber: null, frozenAt: d("2026-08-15"), bestBefore: null, notes: null },
    ]);
  });

  it("round-trips with commas as separator (English)", () => {
    const csv = toCsv(buildExport(source), "en");
    expect(csv).toContain('"Chili ""scharf"", vegan",1.5,l,meals,Oben,3,');
    expect(parseImport(csv, { today: TODAY }).items.map((i) => i.quantity)).toEqual([1.5, 450]);
  });

  it("reads hand-made spreadsheets: labels, German dates, missing columns, tabs", () => {
    const csv = ["Name\tQuantity\tUnit\tCategory\tFrozen_at", "Gulasch\t2\tPortionen\tGerichte\t01.10.2026", "Brot\t\t\t\t", "Eis\t1\tBecher\tdesserts\t2026-10-01"].join("\n");
    const parsed = parseImport(csv, { today: TODAY });
    expect(parsed.items).toEqual([
      // No best_before column: undefined, so the import fills in the food's default.
      { name: "Gulasch", quantity: 2, unit: "portion", category: "meals", drawer: "", containerNumber: null, frozenAt: d("2026-10-01"), bestBefore: undefined, notes: null },
      { name: "Brot", quantity: 1, unit: "piece", category: null, drawer: "", containerNumber: null, frozenAt: TODAY, bestBefore: undefined, notes: null },
    ]);
    expect(parsed.skipped).toEqual([{ row: 4, reason: "unit" }]);
  });

  it("skips invalid rows with a reason", () => {
    const csv = ["name,quantity,container,frozen_at,best_before", ",1,,,", "A,-1,,,", "B,1,x,,", "C,1,,31.02.2026,", "D,1,,,2026-13-01", "E,1,,,"].join("\n");
    const parsed = parseImport(csv, { today: TODAY });
    expect(parsed.items.map((i) => i.name)).toEqual(["E"]);
    expect(parsed.skipped).toEqual([
      { row: 2, reason: "name" },
      { row: 3, reason: "quantity" },
      { row: 4, reason: "container" },
      { row: 5, reason: "date" },
      { row: 6, reason: "date" },
    ]);
  });

  it("needs a name column", () => {
    expect(() => parseImport("foo;bar\n1;2")).toThrow();
  });

  it("parses RFC 4180 fields", () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n\r\n1,,"x\ny"', ",")).toEqual([
      ["a", "b,c", 'd "e"'],
      ["1", "", "x\ny"],
    ]);
  });

  it("parses ISO and German dates, and rejects impossible ones", () => {
    expect(parseDate("2026-10-22")).toBe(TODAY);
    expect(parseDate("22.10.2026")).toBe(TODAY);
    expect(parseDate("2.1.2026")).toBe(d("2026-01-02"));
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("10/22/2026")).toBeNull();
  });
});

describe("JSON", () => {
  it("round-trips an export including suggestions and barcodes", () => {
    const parsed = parseImport(JSON.stringify(buildExport(source)), { today: TODAY });
    expect(parsed).toMatchObject({
      kind: "json",
      freezerName: "Keller",
      drawers: ["Oben", "Unten"],
      suggestions: source.suggestions,
      barcodes: source.barcodes,
      skipped: [],
    });
    expect(parsed.items).toHaveLength(2);
    expect(parsed.items[0]).toMatchObject({ drawer: "Oben", containerNumber: 3, bestBefore: d("2026-12-01") });
  });

  it("rejects other JSON", () => {
    expect(() => parseImport('{"hello": "world"}')).toThrow();
    expect(() => parseImport("{nope")).toThrow();
  });
});

describe("planning", () => {
  it("matches drawers by name, ignoring case, and respects the drawer limit", () => {
    expect(planDrawers(["Oben", "Unten"], ["oben ", "Mitte", "MITTE", ""])).toEqual({ create: ["Mitte"], overLimit: [] });
    const full = Array.from({ length: MAX_DRAWERS - 1 }, (_, i) => `D${i}`);
    expect(planDrawers(full, ["A", "B"])).toEqual({ create: ["A"], overLimit: ["B"] });
  });

  it("finds container numbers taken by the freezer or earlier in the file", () => {
    expect(containerConflicts([1, null, 2], [{ containerNumber: 2 }, { containerNumber: 3 }, { containerNumber: 3 }, { containerNumber: null }])).toEqual([2, 3]);
  });

  it("splits large imports into chunks; drawers go with the first", () => {
    const item = { id: "x", name: "A", quantity: 1, unit: "piece" as const, category: null, drawer: "", containerNumber: null, frozenAt: TODAY, notes: null };
    const args: ImportArgs = { freezerId: "f1", drawers: ["Neu"], newDrawerIds: ["n1"], items: Array.from({ length: 2 * MAX_IMPORT_ITEMS + 1 }, () => item) };
    const chunks = chunkImport(args);
    expect(chunks.map((c) => c.items.length)).toEqual([MAX_IMPORT_ITEMS, MAX_IMPORT_ITEMS, 1]);
    expect(chunks.map((c) => c.drawers)).toEqual([["Neu"], [], []]);
    expect(chunkImport({ ...args, items: [] })).toHaveLength(1);
  });
});
