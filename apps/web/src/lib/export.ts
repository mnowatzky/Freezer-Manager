import { todayAsDate } from "@freezer/shared/domain";
import { buildExport, toCsv } from "@freezer/shared/import";
import type { FreezerDetail } from "./freezer-data";
import { locale } from "./i18n";

function download(fileName: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Downloads the freezer as JSON (complete backup) or CSV (one row per item). Runs entirely in the browser. */
export function exportFreezer(freezer: FreezerDetail, format: "json" | "csv") {
  const file = buildExport(freezer);
  const slug = freezer.name.normalize("NFKD").replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "freezer";
  const base = `${slug}-${new Date(todayAsDate()).toISOString().slice(0, 10)}`;
  if (format === "json") download(`${base}.json`, `${JSON.stringify(file, null, 2)}\n`, "application/json");
  else download(`${base}.csv`, toCsv(file, locale), "text/csv;charset=utf-8");
}
