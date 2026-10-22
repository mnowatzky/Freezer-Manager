import { MAX_DRAWERS } from "@freezer/shared/domain";
import { chunkImport, containerConflicts, planDrawers, type ImportArgs, type ParsedImport } from "@freezer/shared/import";
import { useState } from "react";
import type { FreezerDetail } from "../lib/freezer-data";
import { locale, t } from "../lib/i18n";
import { useToast } from "../lib/toast";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { Button, Icon, Sheet } from "./m3";

type Target = "this" | "new";

/**
 * Preview of an import file (what will happen), then the import itself. A JSON export can also
 * become a new freezer. Large files go to the server in several mutator calls.
 */
export function ImportSheet({
  freezer,
  parsed,
  onClose,
  onNewFreezer,
}: {
  freezer: FreezerDetail;
  parsed: ParsedImport | null;
  onClose: () => void;
  onNewFreezer: (id: string) => void;
}) {
  // Keep showing the last file while the sheet animates out; a new file starts a fresh preview.
  const [shown, setShown] = useState({ parsed, version: 0 });
  if (parsed && parsed !== shown.parsed) setShown({ parsed, version: shown.version + 1 });
  return (
    <Sheet open={!!parsed} title={t.data.importTitle} onClose={onClose}>
      {shown.parsed && (
        <Preview key={shown.version} freezer={freezer} parsed={shown.parsed} onClose={onClose} onNewFreezer={onNewFreezer} />
      )}
    </Sheet>
  );
}

function Preview({ freezer, parsed, onClose, onNewFreezer }: { freezer: FreezerDetail; parsed: ParsedImport; onClose: () => void; onNewFreezer: (id: string) => void }) {
  const mutate = useMutate();
  const toast = useToast();
  const canWrite = useCanWrite();
  const [target, setTarget] = useState<Target>("this");
  const [busy, setBusy] = useState(false);
  const newFreezerName = parsed.freezerName;

  // The same planning the mutator does, against this freezer or an empty new one.
  const existingDrawers = target === "this" ? freezer.drawers.map((d) => d.name) : [];
  const drawerPlan =
    target === "this" ? planDrawers(existingDrawers, parsed.drawers) : { create: [], overLimit: parsed.drawers.slice(MAX_DRAWERS) };
  const conflicts = containerConflicts(target === "this" ? freezer.items.map((i) => i.containerNumber) : [], parsed.items);
  const hasContent = parsed.items.length > 0 || (parsed.suggestions?.length ?? 0) > 0 || (parsed.barcodes?.length ?? 0) > 0;

  const run = async () => {
    setBusy(true);
    try {
      let freezerId = freezer.id;
      if (target === "new" && newFreezerName) {
        freezerId = crypto.randomUUID();
        const drawerNames = parsed.drawers.slice(0, MAX_DRAWERS);
        const count = Math.max(1, drawerNames.length);
        const created = await mutate(
          mutators.freezer.create({
            id: freezerId,
            name: newFreezerName,
            drawerIds: Array.from({ length: count }, () => crypto.randomUUID()),
            locale,
            ...(drawerNames.length ? { drawerNames } : {}),
          }),
        );
        if (!created) return;
      }
      const args: ImportArgs = {
        freezerId,
        drawers: parsed.drawers,
        newDrawerIds: drawerPlan.create.map(() => crypto.randomUUID()),
        items: parsed.items.map((i) => ({ ...i, id: crypto.randomUUID() })),
        ...(parsed.suggestions ? { suggestions: parsed.suggestions } : {}),
        ...(parsed.barcodes ? { barcodes: parsed.barcodes } : {}),
      };
      for (const chunk of chunkImport(args)) if (!(await mutate(mutators.freezer.import(chunk)))) return;
      toast(t.data.imported(parsed.items.length));
      if (target === "new") onNewFreezer(freezerId);
      onClose();
    } finally {
      setBusy(false);
    }
  };

  const notes: [string, string][] = [];
  if (drawerPlan.create.length) notes.push(["shelves", t.data.newDrawers(drawerPlan.create.join(", "))]);
  if (drawerPlan.overLimit.length) notes.push(["warning", t.data.overLimit(drawerPlan.overLimit.length)]);
  if (conflicts.length) notes.push(["qr_code_2", t.data.containerConflicts(conflicts.length)]);

  return (
    <div className="flex flex-col gap-4">
      <p className="type-title-medium flex items-center gap-2">
        <Icon name={parsed.kind === "json" ? "data_object" : "table_view"} className="text-primary" />
        {t.data.items(parsed.items.length)}
      </p>

      {newFreezerName && (
        <fieldset className="flex flex-col gap-1">
          {(["this", "new"] as const).map((value) => (
            <label key={value} className="type-body-large flex cursor-pointer items-center gap-3 py-1">
              <input
                type="radio"
                name="import-target"
                className="size-5 accent-primary"
                checked={target === value}
                onChange={() => setTarget(value)}
              />
              {value === "this" ? t.data.intoFreezer(freezer.name) : t.data.asNewFreezer(newFreezerName)}
            </label>
          ))}
        </fieldset>
      )}

      {notes.length > 0 && (
        <ul className="flex flex-col gap-0.5 overflow-hidden rounded-l">
          {notes.map(([icon, text]) => (
            <li key={text} className="type-body-medium flex items-start gap-3 bg-surface-container px-4 py-3">
              <Icon name={icon} className="text-on-surface-variant" />
              <span>{text}</span>
            </li>
          ))}
        </ul>
      )}

      {parsed.skipped.length > 0 && (
        <div className="type-body-medium rounded-l bg-error-container px-4 py-3 text-on-error-container">
          <p>{t.data.skipped(parsed.skipped.length)}</p>
          <ul className="mt-1 list-inside list-disc">
            {parsed.skipped.slice(0, 8).map((s) => (
              <li key={s.row}>
                {t.data.row(s.row)}: {t.data.skipReason[s.reason]}
              </li>
            ))}
            {parsed.skipped.length > 8 && <li>…</li>}
          </ul>
        </div>
      )}

      {!hasContent && <p className="type-body-medium text-on-surface-variant">{t.data.nothingToImport}</p>}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="text" onClick={onClose}>
          {t.common.cancel}
        </Button>
        <Button icon="upload" disabled={!hasContent || !canWrite || busy} onClick={() => void run()}>
          {t.data.importButton}
        </Button>
      </div>
    </div>
  );
}
