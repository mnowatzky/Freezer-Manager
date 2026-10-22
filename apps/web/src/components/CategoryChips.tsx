import type { Category } from "@freezer/shared/domain";
import { useEffect, useRef } from "react";
import { CATEGORY_ICONS } from "../lib/categories";
import { t } from "../lib/i18n";
import { FilterChip } from "./m3";

/**
 * A horizontally scrolling row of category filter chips. Tapping the selected chip clears it.
 * `bleed` is the horizontal padding of the container, so the row scrolls edge to edge.
 */
export function CategoryChips({
  options,
  value,
  onChange,
  label,
  bleed,
}: {
  options: readonly Category[];
  value: Category | null;
  onChange: (value: Category | null) => void;
  label: string;
  bleed: "px-4" | "px-6";
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Keep a preselected chip (when editing, or filled in from a suggestion) visible.
  useEffect(() => {
    if (value) ref.current?.querySelector(`[data-category="${value}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  return (
    <div
      ref={ref}
      role="group"
      aria-label={label}
      className={`no-scrollbar flex gap-2 overflow-x-auto ${bleed} ${bleed === "px-4" ? "-mx-4" : "-mx-6"}`}
    >
      {options.map((c) => (
        <FilterChip key={c} data-category={c} selected={value === c} icon={CATEGORY_ICONS[c]} onClick={() => onChange(value === c ? null : c)}>
          {t.categories[c]}
        </FilterChip>
      ))}
    </div>
  );
}
