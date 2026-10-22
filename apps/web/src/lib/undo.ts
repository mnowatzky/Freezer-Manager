import { queries } from "@freezer/shared/queries";
import { isCategory, type Unit } from "@freezer/shared/domain";
import { useZero } from "@rocicorp/zero/react";
import { useCallback } from "react";
import { quantityLabel } from "./format";
import type { ItemRow } from "./freezer-data";
import { t } from "./i18n";
import { useToast } from "./toast";
import { mutators, useMutate } from "./zero";

/**
 * Take-out and delete with an "Undo" toast. Undo puts the removed amount back via item.putBack,
 * which re-creates the item if needed. Resolves true when the removal itself succeeded.
 */
export function useRemoveWithUndo() {
  const zero = useZero();
  const mutate = useMutate();
  const toast = useToast();

  const putBack = useCallback(
    async (item: ItemRow, amount: number) => {
      const snapshot = {
        id: item.id,
        freezerId: item.freezerId,
        drawerId: item.drawerId,
        containerNumber: item.containerNumber,
        name: item.name,
        unit: item.unit as Unit,
        frozenAt: item.frozenAt,
        notes: item.notes,
        category: isCategory(item.category) ? item.category : null,
        bestBefore: item.bestBefore,
        createdAt: item.createdAt,
      };
      // The mutator silently drops a container number that has been reused since; Zero mutators
      // can't return values, so check the local data beforehand to tell the user.
      let dropped = false;
      if (item.containerNumber !== null) {
        const freezer = await zero.run(queries.freezers.detail({ freezerId: item.freezerId }));
        const items = freezer?.items ?? [];
        dropped =
          !items.some((i) => i.id === item.id) &&
          items.some((i) => i.containerNumber === item.containerNumber);
      }
      if ((await mutate(mutators.item.putBack({ snapshot, amount }))) && dropped)
        toast(t.item.restoredWithoutContainer(item.containerNumber!));
    },
    [zero, mutate, toast],
  );

  const take = useCallback(
    async (item: ItemRow, amount: number) => {
      if (!(await mutate(mutators.item.take({ id: item.id, amount })))) return false;
      toast(t.item.took(item.name, quantityLabel(amount, item.unit)), {
        label: t.common.undo,
        onClick: () => void putBack(item, amount),
      });
      return true;
    },
    [mutate, toast, putBack],
  );

  const remove = useCallback(
    async (item: ItemRow) => {
      if (!(await mutate(mutators.item.delete({ id: item.id })))) return false;
      toast(t.item.deleted(item.name), { label: t.common.undo, onClick: () => void putBack(item, item.quantity) });
      return true;
    },
    [mutate, toast, putBack],
  );

  return { take, remove };
}
