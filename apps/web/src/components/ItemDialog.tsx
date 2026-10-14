import { todayAsDate, UNITS, type Unit } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { useMemo, useState } from "react";
import { recentDrawer, rememberDrawer } from "../lib/active-freezer";
import { dateToInput, inputToDate } from "../lib/format";
import type { FreezerDetail, ItemRow } from "../lib/freezer-data";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { Button, Field, inputClass, Sheet } from "./ui";

type Props = {
  freezer: FreezerDetail;
  /** Edit an existing item; otherwise "Einfrieren" (add). */
  item?: ItemRow;
  containerNumber?: number | null;
  onClose: () => void;
};

export function ItemDialog({ freezer, item, containerNumber = null, onClose }: Props) {
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const defaultDrawer =
    item?.drawerId ??
    freezer.drawers.find((d) => d.id === recentDrawer())?.id ??
    freezer.drawers[0]?.id ??
    "";

  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>((item?.unit as Unit) ?? "piece");
  const [drawerId, setDrawerId] = useState(defaultDrawer);
  const [frozenAt, setFrozenAt] = useState(dateToInput(item?.frozenAt ?? todayAsDate()));
  const [container, setContainer] = useState(String(item?.containerNumber ?? containerNumber ?? ""));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const suggestions = useMemo(() => {
    const q = name.trim().toLocaleLowerCase("de");
    return freezer.suggestions
      .filter((s) => !q || (s.name.toLocaleLowerCase("de").includes(q) && s.name.toLocaleLowerCase("de") !== q))
      .slice(0, 6);
  }, [name, freezer.suggestions]);

  const qty = Number(quantity.replace(",", "."));
  const valid = name.trim() && qty > 0 && drawerId && frozenAt;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!valid) return;
    const fields = {
      drawerId,
      containerNumber: container ? Number(container) : null,
      name: name.trim(),
      quantity: qty,
      unit,
      frozenAt: inputToDate(frozenAt),
      notes: notes.trim() || null,
    };
    const ok = item
      ? await mutate(mutators.item.update({ id: item.id, ...fields }))
      : await mutate(mutators.item.add({ id: crypto.randomUUID(), freezerId: freezer.id, ...fields }));
    if (ok) {
      if (!item) rememberDrawer(drawerId);
      onClose();
    }
  };

  return (
    <Sheet title={item ? de.item.edit : de.freezer.freeze} onClose={onClose}>
      <form onSubmit={submit} className="space-y-3">
        <div className="relative">
          <Field label={de.item.name}>
            <input
              className={inputClass}
              value={name}
              autoFocus={!item}
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
            />
          </Field>
          {showSuggestions && suggestions.length > 0 && (
            <ul className="absolute inset-x-0 z-10 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
              {suggestions.map((s) => (
                <li key={s.id} className="flex items-center border-b border-slate-100 last:border-0">
                  <button
                    type="button"
                    className="flex-1 px-3 py-2.5 text-left hover:bg-slate-50"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      setName(s.name);
                      if (!item) setUnit(s.lastUnit as Unit);
                      setShowSuggestions(false);
                    }}
                  >
                    {s.name}
                  </button>
                  <button
                    type="button"
                    aria-label={de.item.removeSuggestion}
                    title={de.item.removeSuggestion}
                    className="px-3 py-2.5 text-slate-400 hover:text-red-600"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => void mutate(mutators.suggestion.delete({ id: s.id }))}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={de.item.quantity}>
            <input
              className={inputClass}
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
          <Field label={de.item.unit}>
            <select className={inputClass} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
              {UNITS.map((u) => (
                <option key={u} value={u}>
                  {de.units[u]}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label={de.item.drawer}>
            <select className={inputClass} value={drawerId} onChange={(e) => setDrawerId(e.target.value)}>
              {freezer.drawers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label={`${de.item.container} (${de.common.optional})`}>
            <input
              className={inputClass}
              inputMode="numeric"
              pattern="[0-9]*"
              value={container}
              onChange={(e) => setContainer(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
        </div>

        <Field label={de.item.frozenAt}>
          <input type="date" className={inputClass} value={frozenAt} onChange={(e) => setFrozenAt(e.target.value)} />
        </Field>

        <Field label={`${de.item.notes} (${de.common.optional})`}>
          <textarea className={inputClass} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            {de.common.cancel}
          </Button>
          <Button type="submit" disabled={!valid || !canWrite}>
            {item ? de.common.save : de.freezer.freeze}
          </Button>
        </div>
      </form>
    </Sheet>
  );
}
