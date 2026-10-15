import { AnimatePresence, motion, type HTMLMotionProps } from "motion/react";
import { motionScheme } from "../../theme/motion";
import { Icon } from "./Icon";

type FabProps = Omit<HTMLMotionProps<"button">, "children"> & {
  icon: string;
  label: string;
  /** Extended FABs show the label; collapsing animates the width (e.g. on scroll). */
  extended?: boolean;
  variant?: "primary" | "secondary" | "tertiary" | "surface";
  size?: "s" | "m";
};

const colors = {
  primary: "bg-primary-container text-on-primary-container",
  secondary: "bg-secondary-container text-on-secondary-container",
  tertiary: "bg-tertiary-container text-on-tertiary-container",
  surface: "bg-surface-container-high text-primary",
};

/** M3 FAB / extended FAB with Expressive shape morph and spring width changes. */
export function Fab({ icon, label, extended = false, variant = "primary", size = "m", className = "", disabled, ...props }: FabProps) {
  const height = size === "m" ? 56 : 40;
  const radius = size === "m" ? 16 : 12;
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      layout
      className={`state-layer flex cursor-pointer items-center justify-center overflow-hidden shadow-lg shadow-black/15 disabled:cursor-not-allowed disabled:opacity-50 ${colors[variant]} ${className}`}
      style={{ height, minWidth: height, borderRadius: radius, paddingInline: extended ? 16 : 0 }}
      whileTap={disabled ? undefined : { borderRadius: height / 2, scale: 0.96 }}
      transition={motionScheme.defaultSpatial}
      {...props}
    >
      <motion.span layout="position" className="flex items-center gap-3">
        <Icon name={icon} size={size === "m" ? 24 : 20} />
        <AnimatePresence initial={false}>
          {extended && (
            <motion.span
              key="label"
              className="type-label-large whitespace-nowrap"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: "auto" }}
              exit={{ opacity: 0, width: 0 }}
              transition={motionScheme.defaultEffects}
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.span>
    </motion.button>
  );
}
