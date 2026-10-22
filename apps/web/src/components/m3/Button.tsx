import { motion, type HTMLMotionProps } from "motion/react";
import { forwardRef } from "react";
import { motionScheme, PRESSED_RADIUS } from "../../theme/motion";
import { Icon } from "./Icon";

export type ButtonVariant = "filled" | "tonal" | "outlined" | "text" | "error-text" | "elevated" | "error";
type Size = "s" | "m";

const variantClass: Record<ButtonVariant, string> = {
  filled: "bg-primary text-on-primary",
  tonal: "bg-secondary-container text-on-secondary-container",
  outlined: "text-on-surface-variant ring-1 ring-inset ring-outline-variant",
  text: "text-primary",
  "error-text": "text-error",
  elevated: "bg-surface-container-low text-primary shadow-sm",
  error: "bg-error text-on-error",
};

const sizeClass: Record<Size, { cls: string; height: number; icon: number }> = {
  s: { cls: "h-10 px-4 gap-2 type-label-large", height: 40, icon: 20 },
  m: { cls: "h-14 px-6 gap-2 type-title-medium", height: 56, icon: 24 },
};

type ButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  variant?: ButtonVariant;
  size?: Size;
  icon?: string;
  children?: React.ReactNode;
};

/** M3 Expressive button: pill at rest, morphs to a rounder square while pressed. */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "filled", size = "s", icon, className = "", children, disabled, ...props },
  ref,
) {
  const s = sizeClass[size];
  return (
    <motion.button
      ref={ref}
      disabled={disabled}
      className={`state-layer inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap select-none disabled:cursor-not-allowed disabled:bg-on-surface/10 disabled:text-on-surface/40 disabled:shadow-none disabled:ring-0 ${s.cls} ${variantClass[variant]} ${className}`}
      style={{ borderRadius: s.height / 2 }}
      whileTap={disabled ? undefined : { borderRadius: PRESSED_RADIUS }}
      transition={motionScheme.fastSpatial}
      {...props}
    >
      {icon && <Icon name={icon} size={s.icon} />}
      {children}
    </motion.button>
  );
});

type IconButtonProps = Omit<HTMLMotionProps<"button">, "children"> & {
  icon: string;
  label: string;
  variant?: "standard" | "filled" | "tonal" | "outlined";
  selected?: boolean;
  size?: number;
};

/** M3 icon button. Round at rest; pressed or selected it morphs toward a square. */
export function IconButton({
  icon,
  label,
  variant = "standard",
  selected,
  size = 40,
  className = "",
  disabled,
  ...props
}: IconButtonProps) {
  const colors = {
    standard: selected ? "text-primary" : "text-on-surface-variant",
    filled: selected ? "bg-primary text-on-primary" : "bg-surface-container-highest text-primary",
    tonal: selected ? "bg-secondary text-on-secondary" : "bg-secondary-container text-on-secondary-container",
    outlined: "text-on-surface-variant ring-1 ring-inset ring-outline-variant",
  }[variant];
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      disabled={disabled}
      className={`state-layer inline-flex shrink-0 cursor-pointer items-center justify-center disabled:opacity-40 ${colors} ${className}`}
      style={{ width: size, height: size }}
      initial={false}
      animate={{ borderRadius: selected ? PRESSED_RADIUS : size / 2 }}
      whileTap={disabled ? undefined : { borderRadius: PRESSED_RADIUS, scale: 0.94 }}
      transition={motionScheme.fastSpatial}
      {...props}
    >
      <Icon name={icon} filled={selected} size={Math.round(size * 0.6)} />
    </motion.button>
  );
}
