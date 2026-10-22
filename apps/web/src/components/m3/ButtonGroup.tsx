import { motion } from "motion/react";
import { motionScheme } from "../../theme/motion";
import { Icon } from "./Icon";

type Option<T extends string> = { value: T; label: string; icon?: string };

/**
 * M3 Expressive connected button group (single select).
 * Segments share small inner corners; the selected one morphs to a full pill.
 * On phones, segments with an icon show their label only while selected, so four fit without truncating.
 */
export function ConnectedButtonGroup<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: readonly Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-0.5">
      {options.map((o, i) => {
        const selected = o.value === value;
        const first = i === 0;
        const last = i === options.length - 1;
        const outer = 20;
        const inner = 8;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(o.value)}
            title={o.label}
            className={`state-layer flex h-10 min-w-0 cursor-pointer items-center justify-center gap-1.5 px-3 type-label-large ${
              o.icon && !selected ? "flex-1 sm:flex-[2]" : "flex-[2]"
            } ${
              selected ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container-high text-on-surface-variant"
            }`}
            initial={false}
            animate={{
              borderTopLeftRadius: selected || first ? outer : inner,
              borderBottomLeftRadius: selected || first ? outer : inner,
              borderTopRightRadius: selected || last ? outer : inner,
              borderBottomRightRadius: selected || last ? outer : inner,
            }}
            whileTap={{ scale: 0.96 }}
            transition={motionScheme.fastSpatial}
          >
            {o.icon && <Icon name={o.icon} filled={selected} size={18} />}
            <span className={o.icon && !selected ? "sr-only sm:not-sr-only sm:truncate" : "truncate"}>{o.label}</span>
          </motion.button>
        );
      })}
    </div>
  );
}
