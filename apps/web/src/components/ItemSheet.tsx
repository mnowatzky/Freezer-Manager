import { de } from "@freezer/shared/i18n";
import { useState } from "react";
import { ageLabel, formatDate, quantityLabel } from "../lib/format";
import type { FreezerDetail, ItemRow } from "../lib/freezer-data";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { ItemDialog } from "./ItemDialog";
import { Button, Sheet } from "./ui";

/** Details of one item with "Entnehmen…" (partial or all) and "Bearbeiten". */
export function ItemSheet({ freezer, item, onClose }: { freezer: FreezerDetail; item: ItemRow; onClose: () => void }) {
  const [mode, setMode] = useState<"view" | "take" | "edit">("view");
  const canWrite = useCanWrite();
  const drawer = freezer.drawers.find((d) => d.id === item.drawerId);

  if (mode === "edit") return <ItemDialog freezer={freezer} item={item} onClose={onClose} />;
  if (mode === "take") return <TakeSheet item={item} onClose={onClose} />;

  return (
    <Sheet title={item.name} onClose={onClose}>
      <dl className="mb-5 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-slate-500">{de.item.quantity}</dt>
        <dd>{quantityLabel(item.quantity, item.unit)}</dd>
        <dt className="text-slate-500">{de.item.drawer}</dt>
        <dd>{drawer?.name}</dd>
        {item.containerNumber !== null && (
          <>
            <dt className="text-slate-500">{de.item.container}</dt>
            <dd>#{item.containerNumber}</dd>
          </>
        )}
        <dt className="text-slate-500">{de.item.frozenAt}</dt>
        <dd>
          {formatDate(item.frozenAt)} ({ageLabel(item.frozenAt)})
        </dd>
        {item.notes && (
          <>
            <dt className="text-slate-500">{de.item.notes}</dt>
            <dd className="whitespace-pre-wrap">{item.notes}</dd>
          </>
        )}
      </dl>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" disabled={!canWrite} onClick={() => setMode("edit")}>
          {de.item.edit}
        </Button>
        <Button disabled={!canWrite} onClick={() => setMode("take")}>
          {de.item.take}
        </Button>
      </div>
    </Sheet>
  );
}

function TakeSheet({ item, onClose }: { item: ItemRow; onClose: () => void }) {
  const mutate = useMutate();
  const canWrite = useCanWrite();
  const step = item.quantity >= 1 && Number.isInteger(item.quantity) ? 1 : item.quantity / 4;
  const [amount, setAmount] = useState(Math.min(step, item.quantity));
  const clamp = (n: number) => Math.min(item.quantity, Math.max(step, Math.round(n * 1000) / 1000));

  const take = async (value: number) => {
    if (await mutate(mutators.item.take({ id: item.id, amount: value }))) onClose();
  };

  return (
    <Sheet title={de.item.takeTitle} onClose={onClose}>
      <p className="mb-4 text-sm text-slate-500">
        {item.name}: {quantityLabel(item.quantity, item.unit)}
      </p>
      <div className="mb-5 flex items-center justify-center gap-4">
        <Button variant="secondary" className="size-12 text-xl" onClick={() => setAmount((a) => clamp(a - step))}>
          −
        </Button>
        <span className="min-w-24 text-center text-2xl font-semibold">{quantityLabel(amount, item.unit)}</span>
        <Button variant="secondary" className="size-12 text-xl" onClick={() => setAmount((a) => clamp(a + step))}>
          +
        </Button>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" disabled={!canWrite} onClick={() => take(item.quantity)}>
          {de.common.all}
        </Button>
        <Button disabled={!canWrite} onClick={() => take(amount)}>
          {de.item.takeConfirm}
        </Button>
      </div>
    </Sheet>
  );
}
