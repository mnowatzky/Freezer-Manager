import {
  CATEGORY_IDS,
  defaultBestBefore,
  isCategory,
  parsePackageSize,
  shelfLifeMonths,
  suggestionId,
  todayAsDate,
  UNITS,
  type Category,
  type Unit,
} from "@freezer/shared/domain";
import { t } from "../lib/i18n";
import { AnimatePresence, motion, useIsPresent } from "motion/react";
import { useMemo, useRef, useState } from "react";
import { recentDrawer, rememberDrawer } from "../lib/active-freezer";
import { lookupBarcode } from "../lib/barcode-lookup";
import { dateToInput, inputToDate, quantityLabel } from "../lib/format";
import type { FreezerDetail, ItemRow } from "../lib/freezer-data";
import { useToast } from "../lib/toast";
import { useRemoveWithUndo } from "../lib/undo";
import { mutators, useCanWrite, useMutate } from "../lib/zero";
import { motionScheme } from "../theme/motion";
import { CategoryChips } from "./CategoryChips";
import { Button, FilterChip, Icon, IconButton, SelectField, Sheet, TextArea, TextField } from "./m3";
import { ScannerView } from "./Scanner";

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
    <Sheet open={open} title={t.freezer.freeze} onClose={onClose}>
      <ItemForm {...props} onDone={onClose} />
    </Sheet>
  );
}

/** Suggestion chip; `inert` while it animates out so Tab can't land on a chip that's leaving. */
function SuggestionChip({ children, ...props }: React.ComponentProps<typeof motion.div>) {
  const isPresent = useIsPresent();
  return (
    <motion.div {...props} inert={!isPresent}>
      {children}
    </motion.div>
  );
}

export function ItemForm({ freezer, item, containerNumber = null, onDone }: FormProps) {
  const mutate = useMutate();
  const { remove } = useRemoveWithUndo();
  const canWrite = useCanWrite();
  const defaultDrawer =
    item?.drawerId ?? freezer.drawers.find((d) => d.id === recentDrawer())?.id ?? freezer.drawers[0]?.id ?? "";

  const [name, setName] = useState(item?.name ?? "");
  const [quantity, setQuantity] = useState(String(item?.quantity ?? 1));
  const [unit, setUnit] = useState<Unit>((item?.unit as Unit) ?? "piece");
  const [category, setCategory] = useState<Category | null>(isCategory(item?.category) ? item.category : null);
  const [drawerId, setDrawerId] = useState(defaultDrawer);
  const [frozenAt, setFrozenAt] = useState(dateToInput(item?.frozenAt ?? todayAsDate()));
  const [container, setContainer] = useState(String(item?.containerNumber ?? containerNumber ?? ""));
  const [notes, setNotes] = useState(item?.notes ?? "");
  // Best-before follows the food's storage time until it's edited by hand. When editing an item, its
  // stored date (or none) counts as chosen, so existing items aren't changed behind the user's back.
  const [manualBestBefore, setManualBestBefore] = useState<string | null>(
    item ? (item.bestBefore !== null ? dateToInput(item.bestBefore) : "") : null,
  );
  const [focused, setFocused] = useState(false);
  const nameAreaRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  // Barcode scanning (only when freezing something new): the scanner replaces the form meanwhile.
  const [scanning, setScanning] = useState(false);
  const [barcode, setBarcode] = useState<string | null>(null);
  const [fromOpenFoodFacts, setFromOpenFoodFacts] = useState(false);
  const [packageSize, setPackageSize] = useState<ReturnType<typeof parsePackageSize>>(null);

  const suggestions = useMemo(() => {
    const q = name.trim().toLocaleLowerCase("de");
    return freezer.suggestions
      .filter((s) => !q || (s.name.toLocaleLowerCase("de").includes(q) && s.name.toLocaleLowerCase("de") !== q))
      .slice(0, 5);
  }, [name, freezer.suggestions]);

  const remembered = freezer.suggestions.find((s) => s.id === suggestionId(freezer.id, name))?.shelfLifeMonths;
  const months = shelfLifeMonths(remembered, category);
  const autoBestBefore = frozenAt ? defaultBestBefore(inputToDate(frozenAt), months) : null;
  const bestBefore = manualBestBefore ?? (autoBestBefore !== null ? dateToInput(autoBestBefore) : "");

  const chooseCategory = (c: Category | null) => {
    setCategory(c);
    // An item from before best-before dates gets the default once someone gives it a category.
    if (item?.bestBefore === null && manualBestBefore === "") setManualBestBefore(null);
  };

  const onBarcode = async (code: string) => {
    const nameFromEarlierScan = barcode !== null;
    setScanning(false);
    setBarcode(code);
    setFromOpenFoodFacts(false);
    setPackageSize(null);
    const found = await lookupBarcode(code, freezer);
    if (found.source === "freezer") {
      setName(found.name);
      if (found.unit) {
        setQuantity(String(found.quantity));
        setUnit(found.unit);
      }
      chooseCategory(found.category);
    } else if (found.source === "off") {
      setName(found.name);
      if (found.category) chooseCategory(found.category);
      // One bag or piece by default; the package size (e.g. 750 g) is a one-tap alternative.
      setQuantity("1");
      setUnit(found.category === "vegetables" || found.category === "fruit" || found.category === "herbs" ? "bag" : "piece");
      setPackageSize(parsePackageSize(found.packageSize));
      setFromOpenFoodFacts(true);
    } else {
      // The name field gets focus when the form comes back; don't leave the previous product's name in it.
      if (nameFromEarlierScan) setName("");
      toast(found.reason === "limited" ? t.item.lookupLimited : found.reason === "failed" ? t.item.lookupFailed : t.item.productNotFound);
    }
  };

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
      category,
      bestBefore: bestBefore ? inputToDate(bestBefore) : null,
    };
    const ok = item
      ? await mutate(mutators.item.update({ id: item.id, ...fields }))
      : await mutate(mutators.item.add({ id: crypto.randomUUID(), freezerId: freezer.id, ...fields, ...(barcode ? { barcode } : {}) }));
    if (ok) {
      if (!item) rememberDrawer(drawerId);
      onDone();
    }
  };

  if (scanning)
    return (
      <div className="flex flex-col gap-2">
        <ScannerView mode="barcode" onResult={(code) => void onBarcode(code)} />
        <div className="flex justify-end">
          <Button type="button" variant="text" onClick={() => setScanning(false)}>
            {t.common.cancel}
          </Button>
        </div>
      </div>
    );

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4">
      {/* Focus is tracked on the whole field + chips area, so Tab can reach the chips. */}
      <div
        ref={nameAreaRef}
        onFocus={() => setFocused(true)}
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) setFocused(false);
        }}
      >
        <TextField
          label={t.item.name}
          value={name}
          autoFocus={!item}
          autoComplete="off"
          leadingIcon="kitchen"
          trailing={
            !item && <IconButton icon="barcode_scanner" label={t.item.scanBarcode} className="mr-1" onClick={() => setScanning(true)} />
          }
          onChange={(e) => setName(e.target.value)}
        />
        {barcode && (
          <p className="type-body-small flex flex-wrap items-center gap-x-1 px-4 pt-1 text-on-surface-variant">
            <Icon name="barcode" size={16} />
            <span className="whitespace-nowrap">{t.item.barcode(barcode)}</span>
            {/* Open Food Facts data is licensed under the ODbL, which asks for attribution. */}
            {fromOpenFoodFacts && <span className="whitespace-nowrap">· {t.item.offSource}</span>}
          </p>
        )}
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
              <AnimatePresence initial={false}>
                {suggestions.map((s) => (
                  <SuggestionChip
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
                        if (!item) {
                          setUnit(s.lastUnit as Unit);
                          if (isCategory(s.lastCategory)) setCategory(s.lastCategory);
                        }
                        nameAreaRef.current?.querySelector("input")?.focus();
                      }}
                    >
                      {s.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`${t.item.removeSuggestion}: ${s.name}`}
                      title={t.item.removeSuggestion}
                      className="state-layer flex h-full cursor-pointer items-center pr-1.5 pl-0.5 text-on-surface-variant"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => void mutate(mutators.suggestion.delete({ id: s.id }))}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  </SuggestionChip>
                ))}
              </AnimatePresence>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-2">
        <span className="type-label-medium text-on-surface-variant">
          {t.item.category} ({t.common.optional})
        </span>
        <CategoryChips options={CATEGORY_IDS} value={category} onChange={chooseCategory} label={t.item.category} bleed="px-6" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <TextField label={t.item.quantity} inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <SelectField label={t.item.unit} value={unit} onChange={(e) => setUnit(e.target.value as Unit)}>
          {UNITS.map((u) => (
            <option key={u} value={u}>
              {t.units[u](qty)}
            </option>
          ))}
        </SelectField>
      </div>

      {packageSize && !(qty === packageSize.quantity && unit === packageSize.unit) && (
        <div className="-mt-2 flex">
          <FilterChip
            selected={false}
            icon="scale"
            onClick={() => {
              setQuantity(String(packageSize.quantity));
              setUnit(packageSize.unit);
            }}
          >
            {quantityLabel(packageSize.quantity, packageSize.unit)}
          </FilterChip>
        </div>
      )}

      <div className="grid grid-cols-2 items-start gap-3">
        <SelectField label={t.item.drawer} value={drawerId} onChange={(e) => setDrawerId(e.target.value)}>
          {freezer.drawers.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </SelectField>
        <TextField
          label={t.item.container}
          inputMode="numeric"
          pattern="[0-9]*"
          value={container}
          leadingIcon="qr_code_2"
          supporting={t.common.optional}
          onChange={(e) => setContainer(e.target.value.replace(/\D/g, ""))}
        />
      </div>

      <div className="grid grid-cols-2 items-start gap-3">
        <TextField type="date" label={t.item.frozenAt} value={frozenAt} onChange={(e) => setFrozenAt(e.target.value)} />
        <TextField
          type="date"
          label={t.item.bestBefore}
          value={bestBefore}
          supporting={manualBestBefore === null && months ? t.item.bestBeforeDefault(months) : t.common.optional}
          onChange={(e) => setManualBestBefore(e.target.value)}
        />
      </div>
      <TextArea label={`${t.item.notes} (${t.common.optional})`} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />

      <div className="flex justify-end gap-2 pt-2">
        {item && (
          <Button
            type="button"
            variant="error-text"
            icon="delete"
            className="mr-auto"
            disabled={!canWrite}
            title={t.common.delete}
            onClick={() => void remove(item).then((ok) => ok && onDone())}
          >
            {/* Icon only on phones, so it fits next to Cancel and Save. */}
            <span className="sr-only sm:not-sr-only">{t.common.delete}</span>
          </Button>
        )}
        <Button type="button" variant="text" onClick={onDone}>
          {t.common.cancel}
        </Button>
        <Button type="submit" icon={item ? "check" : "ac_unit"} disabled={!valid || !canWrite}>
          {item ? t.common.save : t.freezer.freeze}
        </Button>
      </div>
    </form>
  );
}
