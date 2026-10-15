import { de } from "@freezer/shared/i18n";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { useMemo, useState } from "react";
import { Navigate, useNavigate } from "react-router";
import { FullScreenLoading } from "../components/AuthedLayout";
import { ItemDialog } from "../components/ItemDialog";
import { ItemSheet } from "../components/ItemSheet";
import { Chip, ConnectedButtonGroup, Fab, Icon, IconButton, ListGroup, ListItem, Sheet, TopAppBar } from "../components/m3";
import { Scanner } from "../components/Scanner";
import { ageLabel, quantityLabel } from "../lib/format";
import { useFreezerData, type FreezerDetail, type ItemRow } from "../lib/freezer-data";
import { useCanWrite } from "../lib/zero";
import { motionScheme } from "../theme/motion";

type View = "drawer" | "date" | "name";

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
  const [dialog, setDialog] = useState<"freeze" | "scan" | "switch" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = freezer.items.find((i) => i.id === selectedId);

  // Extended FAB collapses while scrolling down, expands when scrolling up (M3 behavior).
  const { scrollY } = useScroll();
  const [fabExtended, setFabExtended] = useState(true);
  useMotionValueEvent(scrollY, "change", (y) => {
    const prev = scrollY.getPrevious() ?? 0;
    if (Math.abs(y - prev) > 4) setFabExtended(y < prev || y < 40);
  });

  const items = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("de");
    const filtered = q ? freezer.items.filter((i) => i.name.toLocaleLowerCase("de").includes(q)) : [...freezer.items];
    if (view === "name") filtered.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return filtered; // already sorted oldest first by the query
  }, [freezer.items, search, view]);

  return (
    <div className="min-h-dvh pb-40">
      <TopAppBar
        title={freezer.name}
        subtitle={de.freezer.itemCount(freezer.items.length)}
        actions={
          <>
            {data.freezers.length > 1 && (
              <IconButton icon="kitchen" label={de.freezer.switchFreezer} onClick={() => setDialog("switch")} />
            )}
            <IconButton icon="settings" label={de.freezer.settings} onClick={() => navigate("/einstellungen")} />
          </>
        }
      />

      <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4">
        <label className="flex h-14 items-center gap-3 rounded-full bg-surface-container-high px-4 focus-within:ring-2 focus-within:ring-primary">
          <Icon name="search" className="text-on-surface-variant" />
          <input
            type="search"
            className="type-body-large min-w-0 flex-1 bg-transparent outline-none placeholder:text-on-surface-variant"
            placeholder={de.freezer.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <ConnectedButtonGroup
          label={de.freezer.view}
          value={view}
          onChange={setView}
          options={[
            { value: "drawer", label: de.freezer.viewDrawer, icon: "shelves" },
            { value: "date", label: de.freezer.viewDate, icon: "calendar_month" },
            { value: "name", label: de.freezer.viewName, icon: "sort_by_alpha" },
          ]}
        />

        {freezer.items.length === 0 ? (
          <EmptyState icon="ac_unit" title={de.freezer.noItems} hint={de.freezer.noItemsHint} />
        ) : items.length === 0 ? (
          <EmptyState icon="search" title={de.freezer.noResults} />
        ) : view === "drawer" ? (
          freezer.drawers.map((d) => {
            const inDrawer = items.filter((i) => i.drawerId === d.id);
            if (search && inDrawer.length === 0) return null;
            return (
              <motion.section key={d.id} layout="position" transition={motionScheme.defaultSpatial}>
                <h2 className="type-title-small mt-2 mb-2 flex items-center gap-2 px-1 text-primary">
                  <Icon name="shelves" size={18} />
                  {d.name}
                  <span className="type-label-medium text-on-surface-variant">· {inDrawer.length}</span>
                </h2>
                {inDrawer.length === 0 ? (
                  <p className="type-body-medium rounded-li bg-surface-container-low px-4 py-4 text-on-surface-variant">
                    {de.freezer.empty}
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
      </div>

      {/* FAB stack: secondary "Scannen" above the extended primary "Einfrieren". */}
      <div className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 flex flex-col items-end gap-3">
        <Fab icon="qr_code_scanner" label={de.freezer.scan} variant="secondary" size="s" onClick={() => setDialog("scan")} />
        <Fab icon="ac_unit" label={de.freezer.freeze} extended={fabExtended} disabled={!canWrite} onClick={() => setDialog("freeze")} />
      </div>

      <ItemDialog open={dialog === "freeze"} freezer={freezer} onClose={() => setDialog(null)} />
      <Scanner open={dialog === "scan"} onResult={(n) => navigate(`/c/${n}`)} onClose={() => setDialog(null)} />
      <ItemSheet freezer={freezer} item={selected} onClose={() => setSelectedId(null)} />
      <Sheet open={dialog === "switch"} title={de.freezer.switchFreezer} onClose={() => setDialog(null)}>
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
      <AnimatePresence initial={false} mode="popLayout">
        {items.map((item) => (
          <ListItem
            key={item.id}
            onClick={() => onSelect(item.id)}
            leading={<Monogram name={item.name} />}
            headline={item.name}
            supporting={
              <>
                {quantityLabel(item.quantity, item.unit)} · {ageLabel(item.frozenAt)}
                {drawers && ` · ${drawers.find((d) => d.id === item.drawerId)?.name ?? ""}`}
              </>
            }
            trailing={item.containerNumber !== null ? <Chip icon="qr_code_2">{item.containerNumber}</Chip> : undefined}
          />
        ))}
      </AnimatePresence>
    </ListGroup>
  );
}

/** Leading monogram in an Expressive "cookie" shape container. */
function Monogram({ name }: { name: string }) {
  return (
    <span
      className="type-title-medium type-emphasized flex size-10 shrink-0 items-center justify-center bg-secondary-container text-on-secondary-container"
      style={{ borderRadius: "42% 58% 46% 54% / 50% 44% 56% 50%" }}
    >
      {name.trim().charAt(0).toLocaleUpperCase("de")}
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
