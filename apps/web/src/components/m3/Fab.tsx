import { motion, type HTMLMotionProps } from "motion/react";
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
  const iconSize = size === "m" ? 24 : 20;
  // Constant padding keeps the collapsed FAB square; only the label's width animates,
  // so the button grows and shrinks with it instead of via a scaling layout animation.
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      className={`state-layer flex cursor-pointer items-center overflow-hidden shadow-lg shadow-black/15 disabled:cursor-not-allowed disabled:opacity-50 ${colors[variant]} ${className}`}
      style={{ height, borderRadius: radius, paddingInline: (height - iconSize) / 2 }}
      whileTap={disabled ? undefined : { borderRadius: height / 2, scale: 0.96 }}
      transition={motionScheme.defaultSpatial}
      {...props}
    >
      <Icon name={icon} size={iconSize} />
      <motion.span
        aria-hidden
        className="type-label-large overflow-hidden whitespace-nowrap"
        initial={false}
        animate={{ width: extended ? "auto" : 0, opacity: extended ? 1 : 0 }}
        transition={{ width: motionScheme.defaultSpatial, opacity: motionScheme.defaultEffects }}
      >
        <span className="block pl-3">{label}</span>
      </motion.span>
    </motion.button>
  );
}
