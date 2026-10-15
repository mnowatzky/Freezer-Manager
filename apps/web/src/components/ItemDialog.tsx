import { todayAsDate, UNITS, type Unit } from "@freezer/shared/domain";
import { de } from "@freezer/shared/i18n";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { recentDrawer, rememberDrawer } from "../lib/active-freezer";
import { dateToInput, inputToDate } from "../lib/format";
import type { FreezerDetail, ItemRow } from "../lib/freezer-data";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { motionScheme } from "../theme/motion";
import { Button, Icon, SelectField, Sheet, TextArea, TextField } from "./m3";

type FormProps = {
  freezer: FreezerDetail;
  /** Edit an existing item; otherwise "Einfrieren" (add). */
  item?: ItemRow;
  containerNumber?: number | null;
  onDone: () => void;
};

/** "Einfrieren" (add) sheet. */
export function ItemDialog({ open, onClose, ...props }: Omit<FormProps, "onDone"> & { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} title={de.freezer.freeze} onClose={onClose}>
      <ItemForm {...props} onDone={onClose} />
    </Sheet>
  );
}

export function ItemForm({ freezer, item, containerNumber = null, onDone }: FormProps) {
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const defaultDrawer =
    item?.drawerId ?? freezer.drawers.find((d) => d.id === recentDrawer())?.id ?? freezer.drawers[0]?.id ?? "";

  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>((item?.unit as Unit) ?? "piece");
  const [drawerId, setDrawerId] = useState(defaultDrawer);
  const [frozenAt, setFrozenAt] = useState(dateToInput(item?.frozenAt ?? todayAsDate()));
  const [container, setContainer] = useState(String(item?.containerNumber ?? containerNumber ?? ""));
  const [notes, setNotes] = useState(item?.notes ?? "");
  const [focused, setFocused] = useState(false);

  const suggestions = useMemo(() => {
    const q = name.trim().toLocaleLowerCase("de");
    return freezer.suggestions
      .filter((s) => !q || (s.name.toLocaleLowerCase("de").includes(q) && s.name.toLocaleLowerCase("de") !== q))
      .slice(0, 5);
  }, [name, freezer.suggestions]);

  const qty = Number(quantity.replace(",", "."));
  const valid = Boolean(name.trim() && qty > 0 && drawerId && frozenAt);

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
      onDone();
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <TextField
          label={de.item.name}
          value={name}
          autoFocus={!item}
          autoComplete="off"
          leadingIcon="kitchen"
          onChange={(e) => setName(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
        {/* Suggestions as chips that animate in/out; ✕ removes a suggestion for everyone. */}
        <AnimatePresence initial={false}>
          {focused && suggestions.length > 0 && (
            <motion.div
              className="flex flex-wrap gap-2 overflow-hidden"
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={motionScheme.defaultSpatial}
            >
              <div className="h-1 w-full" />
              <AnimatePresence initial={false} mode="popLayout">
                {suggestions.map((s) => (
                  <motion.div
                    key={s.id}
                    layout
                    initial={{ opacity: 0, scale: 0.8 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.8 }}
                    transition={motionScheme.fastSpatial}
                    className="flex h-8 items-center overflow-hidden rounded-s ring-1 ring-outline-variant ring-inset"
                  >
                    <button
                      type="button"
                      className="state-layer type-label-large h-full cursor-pointer pr-2 pl-3 text-on-surface-variant"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setName(s.name);
                        if (!item) setUnit(s.lastUnit as Unit);
                        setFocused(false);
                      }}
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`${de.item.removeSuggestion}: ${s.name}`}
                      title={de.item.removeSuggestion}
                      className="state-layer flex h-full cursor-pointer items-center pr-1.5 pl-0.5 text-on-surface-variant"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void mutate(mutators.suggestion.delete({ id: s.id }))}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label={de.item.quantity} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <SelectField label={de.item.unit} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {de.units[u]}
            </option>
          ))}
        </SelectField>
      </div>

      <div className="grid grid-cols-2 items-start gap-3">
        <SelectField label={de.item.drawer} value={drawerId} onChange={(e) => setDrawerId(e.target.value)}>
          {freezer.drawers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label={de.item.container}
          inputMode="numeric"
          pattern="[0-9]*"
          value={container}
          leadingIcon="qr_code_2"
          supporting={de.common.optional}
          onChange={(e) => setContainer(e.target.value.replace(/\D/g, ""))}
        />
      </div>

      <TextField type="date" label={de.item.frozenAt} value={frozenAt} onChange={(e) => setFrozenAt(e.target.value)} />
      <TextArea label={`${de.item.notes} (${de.common.optional})`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="text" onClick={onDone}>
          {de.common.cancel}
        </Button>
        <Button type="submit" icon={item ? "check" : "ac_unit"} disabled={!valid || !canWrite}>
          {item ? de.common.save : de.freezer.freeze}
        </Button>
      </div>
    </form>
  );
}
