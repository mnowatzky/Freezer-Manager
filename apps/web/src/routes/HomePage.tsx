import { de } from "@freezer/shared/i18n";
import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { Centered } from "../components/AuthedLayout";
import { ItemDialog } from "../components/ItemDialog";
import { ItemSheet } from "../components/ItemSheet";
import { Scanner } from "../components/Scanner";
import { Button, inputClass, PageHeader } from "../components/ui";
import { ageLabel, quantityLabel } from "../lib/format";
import { useFreezerData, type FreezerDetail, type ItemRow } from "../lib/freezer-data";
import { useCanWrite } from "../lib/zero";

type View = "drawer" | "date" | "name";

export function HomePage() {
  const data = useFreezerData();
  if (data.freezersLoaded && data.freezers.length === 0) return <Navigate to="/setup" replace />;
  if (!data.freezer) return <Centered>{data.detailLoaded && data.freezersLoaded ? null : de.common.loading}</Centered>;
  return <FreezerView data={data} freezer={data.freezer} />;
}

function FreezerView({ data, freezer }: { data: ReturnType<typeof useFreezerData>; freezer: FreezerDetail }) {
  const navigate = useNavigate();
  const canWrite = useCanWrite();
  const [view, setView] = useState<View>("drawer");
  const [search, setSearch] = useState("");
  const [dialog, setDialog] = useState<"freeze" | "scan" | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = freezer.items.find((i) => i.id === selectedId);

  const items = useMemo(() => {
    const q = search.trim().toLocaleLowerCase("de");
    const filtered = q ? freezer.items.filter((i) => i.name.toLocaleLowerCase("de").includes(q)) : [...freezer.items];
    if (view === "name") filtered.sort((a, b) => a.name.localeCompare(b.name, "de"));
    return filtered; // already sorted oldest first by the query
  }, [freezer.items, search, view]);

  return (
    <div className="min-h-dvh pb-28">
      <PageHeader
        title={
          data.freezers.length > 1 ? (
            <select
              aria-label={de.freezer.switchFreezer}
              className="max-w-full truncate bg-transparent font-semibold outline-none [&>option]:text-slate-900"
              value={freezer.id}
              onChange={(e) => data.setActiveId(e.target.value)}
            >
              {data.freezers.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          ) : (
            freezer.name
          )
        }
        right={
          <Link to="/einstellungen" className="rounded-lg px-2 py-1 text-xl" aria-label={de.freezer.settings}>
            ⚙︎
          </Link>
        }
      />

      <div className="mx-auto max-w-2xl space-y-3 p-4">
        <input
          type="search"
          className={inputClass}
          placeholder={de.freezer.search}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex gap-1 rounded-lg bg-slate-200 p-1 text-sm">
          {(
            [
              ["drawer", de.freezer.groupByDrawer],
              ["date", de.freezer.sortByDate],
              ["name", de.freezer.sortByName],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              className={`flex-1 rounded-md px-2 py-1.5 font-medium ${view === v ? "bg-white shadow" : "text-slate-600"}`}
              onClick={() => setView(v)}
            >
              {label}
            </button>
          ))}
        </div>

        {freezer.items.length === 0 && <p className="py-8 text-center text-slate-500">{de.freezer.noItems}</p>}

        {view === "drawer" ? (
          freezer.drawers.map((d) => {
            const inDrawer = items.filter((i) => i.drawerId === d.id);
            if (search && inDrawer.length === 0) return null;
            return (
              <section key={d.id}>
                <h2 className="mt-4 mb-1 text-sm font-semibold tracking-wide text-slate-500 uppercase">{d.name}</h2>
                {inDrawer.length === 0 ? (
                  <p className="px-1 text-sm text-slate-400">{de.freezer.empty}</p>
                ) : (
                  <ItemList items={inDrawer} onSelect={setSelectedId} />
                )}
              </section>
            );
          })
        ) : (
          <ItemList items={items} onSelect={setSelectedId} drawers={freezer.drawers} />
        )}
      </div>

      <div className="fixed inset-x-0 bottom-0 flex justify-center gap-3 bg-gradient-to-t from-slate-50 via-slate-50 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <Button variant="secondary" className="flex-1 py-3.5 sm:flex-none" onClick={() => setDialog("scan")}>
          {de.freezer.scan}
        </Button>
        <Button className="flex-1 py-3.5 sm:flex-none" disabled={!canWrite} onClick={() => setDialog("freeze")}>
          {de.freezer.freeze}
        </Button>
      </div>

      {dialog === "freeze" && <ItemDialog freezer={freezer} onClose={() => setDialog(null)} />}
      {dialog === "scan" && <Scanner onResult={(n) => navigate(`/c/${n}`)} onClose={() => setDialog(null)} />}
      {selected && <ItemSheet freezer={freezer} item={selected} onClose={() => setSelectedId(null)} />}
    </div>
  );
}

function ItemList({
  items,
  onSelect,
  drawers,
}: {
  items: ItemRow[];
  onSelect: (id: string) => void;
  drawers?: FreezerDetail["drawers"];
}) {
  return (
    <ul className="divide-y divide-slate-100 overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-slate-200">
      {items.map((item) => (
        <li key={item.id}>
          <button className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-slate-50" onClick={() => onSelect(item.id)}>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{item.name}</div>
              <div className="text-sm text-slate-500">
                {quantityLabel(item.quantity, item.unit)} · {ageLabel(item.frozenAt)}
                {drawers && ` · ${drawers.find((d) => d.id === item.drawerId)?.name ?? ""}`}
              </div>
            </div>
            {item.containerNumber !== null && (
              <span className="rounded-full bg-brand-light/40 px-2.5 py-1 text-sm font-semibold text-brand-dark">
                #{item.containerNumber}
              </span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}
