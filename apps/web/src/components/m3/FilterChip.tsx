import { motion } from "motion/react";
import { motionScheme } from "../../theme/motion";
import { Icon } from "./Icon";

/** M3 filter chip: outlined at rest, tonal and with a filled icon when selected. */
export function FilterChip({
  selected,
  icon,
  onClick,
  children,
  ...props
}: Omit<React.ComponentProps<typeof motion.button>, "children" | "onClick"> & {
  selected: boolean;
  icon?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`state-layer type-label-large inline-flex h-8 shrink-0 cursor-pointer items-center gap-2 rounded-s pr-4 pl-2 whitespace-nowrap ${
        selected ? "bg-secondary-container text-on-secondary-container" : "text-on-surface-variant ring-1 ring-outline-variant ring-inset"
      }`}
      whileTap={{ scale: 0.96 }}
      transition={motionScheme.fastSpatial}
      {...props}
    >
      {icon && <Icon name={icon} filled={selected} size={18} />}
      {children}
    </motion.button>
  );
}
