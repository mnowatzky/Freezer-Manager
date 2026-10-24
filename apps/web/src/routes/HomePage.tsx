import { CATEGORY_IDS, freshness, isCategory, todayAsDate, type Category } from "@freezer/shared/domain";
import { locale, t } from "../lib/i18n";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { FullScreenLoading } from "../components/AuthedLayout";
import { CategoryChips } from "../components/CategoryChips";
import { FreshnessChip } from "../components/FreshnessChip";
import { ItemDialog } from "../components/ItemDialog";
import { ItemSheet } from "../components/ItemSheet";
import { Chip, ConnectedButtonGroup, Fab, Icon, IconButton, ListGroup, ListItem, Sheet, TopAppBar } from "../components/m3";
import { Scanner } from "../components/Scanner";
import { CATEGORY_ICONS } from "../lib/categories";
import { ageLabel, quantityLabel } from "../lib/format";
import { useFreezerData, type FreezerDetail, type ItemRow } from "../lib/freezer-data";
import { useCanWrite } from "../lib/zero";
import { motionScheme } from "../theme/motion";

type View = "drawer" | "date" | "bestBefore" | "name";

// Items without a best-before date sort last.
const byBestBefore = (a: ItemRow, b: ItemRow) => (a.bestBefore ?? Infinity) - (b.bestBefore ?? Infinity);

export function HomePage() {
  const data = useFreezerData();
  if (data.freezersLoaded && data.freezers.length === 0) return <Navigate to="/setup" replace />;
  if (!data.freezer) return <FullScreenLoading />;
  return <FreezerView data={data} freezer={data.freezer} />;
}

function FreezerView({ data, freezer }: { data: ReturnType<typeof useFreezerData>; freezer: FreezerDetail }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [view, setView] = useState<View>("drawer");
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<Category | null>(null);
  const [dialog, setDialog] = useState<"freeze" | "scan" | "switch" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scannedBarcode, setScannedBarcode] = useState<string | null>(null);
  const selected = freezer.items.find((i) => i.id === selectedId);

  // Extended FAB collapses while scrolling down, expands when scrolling up (M3 behavior).
  const { scrollY } = useScroll();
  // Toggle only after a sustained move from the last turning point, so slow scrolling,
  // momentum and iOS overscroll bounce don't make it flicker.
  const [fabExtended, setFabExtended] = useState(true);
  const fabAnchor = useRef({ y: 0, extended: true });
  useMotionValueEvent(scrollY, "change", (raw) => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const y = Math.min(Math.max(raw, 0), Math.max(max, 0));
    const anchor = fabAnchor.current;
    let extended = anchor.extended;
    if (y < 40) extended = true;
    else if (extended ? y - anchor.y > 24 : anchor.y - y > 24) extended = !extended;
    // The anchor follows the furthest point in the current direction.
    if (extended !== anchor.extended || (extended ? y < anchor.y : y > anchor.y)) anchor.y = y;
    anchor.extended = extended;
    setFabExtended(extended);
  });

  // Only categories that currently have items get a filter chip. A filter whose last item is gone
  // is ignored rather than leaving an empty list behind.
  const categories = useMemo(() => {
    const present = new Set(freezer.items.map((i) => i.category));
    return CATEGORY_IDS.filter((c) => present.has(c));
  }, [freezer.items]);
  const category = categoryFilter && categories.includes(categoryFilter) ? categoryFilter : null;

  const items = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("de");
    const filtered = freezer.items.filter(
      (i) => (!category || i.category === category) && (!q || i.name.toLocaleLowerCase("de").includes(q)),
    );
    if (view === "name") filtered.sort((a, b) => a.name.localeCompare(b.name, locale));
    if (view === "bestBefore") filtered.sort(byBestBefore); // stable: ties stay oldest first
    return filtered; // already sorted oldest first by the query
  }, [freezer.items, search, category, view]);
  const filtering = Boolean(search.trim() || category);

  const eatSoon = useMemo(() => {
    const today = todayAsDate();
    return freezer.items.filter((i) => freshness(i.bestBefore, today) !== "ok").sort(byBestBefore);
  }, [freezer.items]);
  const [eatSoonOpen, setEatSoonOpen] = useState(true);

  // A tapped best-before notification opens /?soon: show the "Eat soon" section (state adjusted
  // during render, then the parameter is dropped from the URL).
  const [params, setParams] = useSearchParams();
  const fromNotification = params.has("soon");
  if (fromNotification && (search || categoryFilter || !eatSoonOpen)) {
    setSearch("");
    setCategoryFilter(null);
    setEatSoonOpen(true);
  }
  useEffect(() => {
    if (!fromNotification) return;
    window.scrollTo({ top: 0 });
    setParams({}, { replace: true });
  }, [fromNotification, setParams]);

  return (
    <div className="min-h-dvh pb-40">
      <TopAppBar
        title={freezer.name}
        subtitle={t.freezer.itemCount(freezer.items.length)}
        actions={
          <>
            {data.freezers.length > 1 && (
              <IconButton icon="kitchen" label={t.freezer.switchFreezer} onClick={() => setDialog("switch")} />
            )}
            <IconButton icon="settings" label={t.freezer.settings} onClick={() => void navigate("/settings")} />
          </>
        }
      />

      <main className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-4 focus-within:ring-2 focus-within:ring-primary">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            type="search"
            className="type-body-large min-w-0 flex-1 bg-transparent outline-none placeholder:text-on-surface-variant"
            placeholder={t.freezer.search}
            aria-label={t.freezer.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        {categories.length > 0 && (
          <CategoryChips options={categories} value={category} onChange={setCategoryFilter} label={t.freezer.filterCategory} bleed="px-4" />
        )}

        <ConnectedButtonGroup
          label={t.freezer.view}
          value={view}
          onChange={setView}
          options={[
            { value: "drawer", label: t.freezer.viewDrawer, icon: "shelves" },
            { value: "date", label: t.freezer.viewDate, icon: "calendar_month" },
            { value: "bestBefore", label: t.freezer.viewBestBefore, icon: "hourglass_bottom" },
            { value: "name", label: t.freezer.viewName, icon: "sort_by_alpha" },
          ]}
        />

        {!filtering && eatSoon.length > 0 && (
          <section aria-labelledby="eat-soon">
            <button
              type="button"
              aria-expanded={eatSoonOpen}
              onClick={() => setEatSoonOpen((o) => !o)}
              className="state-layer type-title-small mt-2 mb-2 flex w-full cursor-pointer items-center gap-2 rounded-s px-1 py-1 text-left text-error"
            >
              <Icon name="hourglass_bottom" size={18} />
              <span id="eat-soon">{t.freezer.eatSoon}</span>
              <span className="type-label-medium text-on-surface-variant">· {eatSoon.length}</span>
              <Icon name={eatSoonOpen ? "expand_less" : "expand_more"} size={20} className="ml-auto text-on-surface-variant" />
            </button>
            <AnimatePresence initial={false}>
              {eatSoonOpen && (
                <motion.div
                  className="overflow-hidden"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={motionScheme.defaultSpatial}
                >
                  <ItemList items={eatSoon} onSelect={setSelectedId} drawers={freezer.drawers} />
                </motion.div>
              )}
            </AnimatePresence>
          </section>
        )}

        {freezer.items.length === 0 ? (
          <EmptyState icon="ac_unit" title={t.freezer.noItems} hint={t.freezer.noItemsHint} />
        ) : items.length === 0 ? (
          <EmptyState icon="search" title={t.freezer.noResults} />
        ) : view === "drawer" ? (
          freezer.drawers.map((d) => {
            const inDrawer = items.filter((i) => i.drawerId === d.id);
            if (filtering && inDrawer.length === 0) return null;
            return (
              <motion.section key={d.id} layout="position" transition={motionScheme.defaultSpatial}>
                <h2 className="type-title-small mt-2 mb-2 flex items-center gap-2 px-1 text-primary">
                  <Icon name="shelves" size={18} />
                  {d.name}
                  <span className="type-label-medium text-on-surface-variant">· {inDrawer.length}</span>
                </h2>
                {inDrawer.length === 0 ? (
                  <p className="type-body-medium rounded-li bg-surface-container-low px-4 py-4 text-on-surface-variant">
                    {t.freezer.empty}
                  </p>
                ) : (
                  <ItemList items={inDrawer} onSelect={setSelectedId} />
                )}
              </motion.section>
            );
          })
        ) : (
          <ItemList items={items} onSelect={setSelectedId} drawers={freezer.drawers} />
        )}
      </main>

      {/* FAB stack: secondary "Scannen" above the extended primary "Einfrieren". */}
      <div className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex flex-col items-end gap-3">
        <Fab icon="qr_code_scanner" label={t.freezer.scan} variant="secondary" size="s" onClick={() => setDialog("scan")} />
        <Fab icon="ac_unit" label={t.freezer.freeze} extended={fabExtended} disabled={!canWrite} onClick={() => setDialog("freeze")} />
      </div>

      <ItemDialog
        open={dialog === "freeze"}
        freezer={freezer}
        barcode={scannedBarcode}
        onClose={() => {
          setDialog(null);
          setScannedBarcode(null);
        }}
      />
      {/* Product barcodes start freezing, so only people who can write get them in the scanner. */}
      {canWrite ? (
        <Scanner
          open={dialog === "scan"}
          mode="any"
          onResult={(result) => {
            if ("container" in result) return void navigate(`/c/${result.container}`);
            setScannedBarcode(result.barcode);
            setDialog("freeze");
          }}
          onClose={() => setDialog(null)}
        />
      ) : (
        <Scanner open={dialog === "scan"} onResult={(n) => void navigate(`/c/${n}`)} onClose={() => setDialog(null)} />
      )}
      <ItemSheet freezer={freezer} item={selected} onClose={() => setSelectedId(null)} />
      <Sheet open={dialog === "switch"} title={t.freezer.switchFreezer} onClose={() => setDialog(null)}>
        <ListGroup>
          {data.freezers.map((f) => (
            <ListItem
              key={f.id}
              headline={f.name}
              leading={<Icon name="kitchen" filled={f.id === freezer.id} className="text-primary" />}
              trailing={f.id === freezer.id ? <Icon name="check" className="text-primary" /> : undefined}
              onClick={() => {
                data.setActiveId(f.id);
                setDialog(null);
              }}
            />
          ))}
        </ListGroup>
      </Sheet>
    </div>
  );
}

function ItemList({ items, onSelect, drawers }: { items: ItemRow[]; onSelect: (id: string) => void; drawers?: FreezerDetail["drawers"] }) {
  return (
    <ListGroup>
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ListItem
            key={item.id}
            onClick={() => onSelect(item.id)}
            leading={<Monogram name={item.name} category={item.category} />}
            headline={item.name}
            supporting={
              <>
                {quantityLabel(item.quantity, item.unit)} · {ageLabel(item.frozenAt)}
                {drawers && ` · ${drawers.find((d) => d.id === item.drawerId)?.name ?? ""}`}
              </>
            }
            trailing={
              <div className="flex flex-col items-end gap-1">
                <FreshnessChip bestBefore={item.bestBefore} />
                {item.containerNumber !== null && <Chip icon="qr_code_2">{item.containerNumber}</Chip>}
              </div>
            }
          />
        ))}
      </AnimatePresence>
    </ListGroup>
  );
}

/** Leading category icon (or the name's first letter) in an Expressive "cookie" shape container. */
function Monogram({ name, category }: { name: string; category: string | null }) {
  return (
    <span
      className="type-title-medium type-emphasized flex size-10 shrink-0 items-center justify-center bg-secondary-container text-on-secondary-container"
      style={{ borderRadius: "42% 58% 46% 54% / 50% 44% 56% 50%" }}
    >
      {isCategory(category) ? <Icon name={CATEGORY_ICONS[category]} size={22} /> : name.trim().charAt(0).toLocaleUpperCase("de")}
    </span>
  );
}

function EmptyState({ icon, title, hint }: { icon: string; title: string; hint?: string }) {
  return (
    <motion.div
      className="flex flex-col items-center gap-3 py-12 text-center"
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={motionScheme.slowSpatial}
    >
      <motion.div
        className="flex size-24 items-center justify-center bg-primary-container text-on-primary-container"
        style={{ borderRadius: "38%" }}
        animate={{ rotate: [0, 8, -8, 0] }}
        transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
      >
        <Icon name={icon} size={48} />
      </motion.div>
      <div className="type-title-large">{title}</div>
      {hint && <div className="type-body-medium max-w-xs text-on-surface-variant">{hint}</div>}
    </motion.div>
  );
}
