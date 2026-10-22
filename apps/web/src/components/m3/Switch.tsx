import { motion } from "motion/react";
import { motionScheme } from "../../theme/motion";
import { Icon } from "./Icon";

/** M3 switch: the handle grows and shows a check when on. */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-8 w-13 shrink-0 cursor-pointer items-center rounded-full disabled:cursor-not-allowed disabled:opacity-40 ${
        checked ? "bg-primary" : "bg-surface-container-highest ring-2 ring-outline ring-inset"
      }`}
    >
      <motion.span
        className={`flex items-center justify-center rounded-full ${checked ? "bg-on-primary text-primary" : "bg-outline"}`}
        initial={false}
        animate={{ x: checked ? 24 : 8, width: checked ? 24 : 16, height: checked ? 24 : 16 }}
        transition={motionScheme.fastSpatial}
      >
        {checked && <Icon name="check" size={16} />}
      </motion.span>
    </button>
  );
}
