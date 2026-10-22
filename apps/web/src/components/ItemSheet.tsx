import { t } from "../lib/i18n";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { ageLabel, formatDate, quantityLabel } from "../lib/format";
import { useHoldRepeat } from "../lib/hold-repeat";
import type { FreezerDetail, ItemRow } from "../lib/freezer-data";
import { useRemoveWithUndo } from "../lib/undo";
import { useCanWrite } from "../lib/zero";
import { motionScheme } from "../theme/motion";
import { ItemForm } from "./ItemDialog";
import { Button, Icon, IconButton, Sheet } from "./m3";

type Mode = "view" | "take" | "edit";

/**
 * One sheet for an item: details → "Entnehmen…" (partial/all) or "Bearbeiten".
 * Modes swap inside the same sheet, which springs to the new height.
 */
export function ItemSheet({ freezer, item, onClose }: { freezer: FreezerDetail; item: ItemRow | undefined; onClose: () => void }) {
  // Keep showing the last item while the sheet animates out (or if it's deleted remotely),
  // and reset to the details view when a different item is opened. Both are derived during
  // render (React's "adjust state on prop change" pattern) instead of in effects.
  const [shown, setShown] = useState(item);
  const [mode, setMode] = useState<Mode>("view");
  if (item && item !== shown) {
    if (item.id !== shown?.id) setMode("view");
    setShown(item);
  }

  const title = mode === "take" ? t.item.takeTitle : mode === "edit" ? t.item.edit : shown?.name;

  return (
    <Sheet open={!!item} title={title} onClose={onClose}>
      {shown && (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={mode}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={motionScheme.defaultSpatial}
          >
            {mode === "view" && <Details freezer={freezer} item={shown} onMode={setMode} />}
            {mode === "take" && <Take item={shown} onDone={onClose} onBack={() => setMode("view")} />}
            {mode === "edit" && <ItemForm freezer={freezer} item={shown} onDone={onClose} />}
          </motion.div>
        </AnimatePresence>
      )}
    </Sheet>
  );
}

function Details({ freezer, item, onMode }: { freezer: FreezerDetail; item: ItemRow; onMode: (m: Mode) => void }) {
  const canWrite = useCanWrite();
  const drawer = freezer.drawers.find((d) => d.id === item.drawerId);
  const rows: [string, string, React.ReactNode][] = [
    ["scale", t.item.quantity, quantityLabel(item.quantity, item.unit)],
    ["shelves", t.item.drawer, drawer?.name],
    ["calendar_month", t.item.frozenAt, `${formatDate(item.frozenAt)} · ${ageLabel(item.frozenAt)}`],
  ];
  if (item.containerNumber !== null) rows.push(["qr_code_2", t.item.container, `#${item.containerNumber}`]);
  if (item.notes) rows.push(["notes", t.item.notes, <span key="notes" className="whitespace-pre-wrap">{item.notes}</span>]);

  return (
    <>
      <dl className="mb-6 flex flex-col gap-0.5 overflow-hidden rounded-l">
        {rows.map(([icon, label, value]) => (
          <div key={label} className="flex items-center gap-4 bg-surface-container px-4 py-3">
            <Icon name={icon} className="text-on-surface-variant" />
            <div className="min-w-0">
              <dt className="type-label-medium text-on-surface-variant">{label}</dt>
              <dd className="type-body-large">{value}</dd>
            </div>
          </div>
        ))}
      </dl>
      <div className="flex justify-end gap-2">
        <Button variant="tonal" icon="edit" disabled={!canWrite} onClick={() => onMode("edit")}>
          {t.item.edit}
        </Button>
        <Button icon="remove" disabled={!canWrite} onClick={() => onMode("take")}>
          {t.item.take}
        </Button>
      </div>
    </>
  );
}

function Take({ item, onDone, onBack }: { item: ItemRow; onDone: () => void; onBack: () => void }) {
  const { take: takeWithUndo } = useRemoveWithUndo();
  const canWrite = useCanWrite();
  const step = item.quantity >= 1 && Number.isInteger(item.quantity) ? 1 : item.quantity / 4;
  const [amount, setAmount] = useState(Math.min(step, item.quantity));
  const clamp = (n: number) => Math.min(item.quantity, Math.max(step, Math.round(n * 1000) / 1000));
  const remaining = Math.max(0, Math.round((item.quantity - amount) * 1000) / 1000);
  const less = useHoldRepeat(() => setAmount((a) => clamp(a - step)));
  const more = useHoldRepeat(() => setAmount((a) => clamp(a + step)));

  const take = async (value: number) => {
    if (await takeWithUndo(item, value)) onDone();
  };

  return (
    <>
      <p className="type-body-medium mb-6 text-on-surface-variant">
        {item.name}: {quantityLabel(item.quantity, item.unit)}
      </p>
      <div className="mb-2 flex items-center justify-center gap-6">
        <IconButton icon="remove" label={t.common.less} variant="tonal" size={56} {...less} />
        <div className="min-w-32 text-center">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={amount}
              className="type-display-small type-emphasized"
              initial={{ opacity: 0, y: -12, scale: 0.9 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.9 }}
              transition={motionScheme.fastSpatial}
            >
              {quantityLabel(amount, item.unit)}
            </motion.div>
          </AnimatePresence>
        </div>
        <IconButton icon="add" label={t.common.more} variant="tonal" size={56} {...more} />
      </div>
      <p className="type-body-small mb-6 text-center text-on-surface-variant">
        → {quantityLabel(remaining, item.unit)}
      </p>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="text" onClick={onBack}>
          {t.common.back}
        </Button>
        <Button variant="tonal" disabled={!canWrite} onClick={() => void take(item.quantity)}>
          {t.common.all}
        </Button>
        <Button icon="remove" disabled={!canWrite} onClick={() => void take(amount)}>
          {t.item.takeConfirm}
        </Button>
      </div>
    </>
  );
}
