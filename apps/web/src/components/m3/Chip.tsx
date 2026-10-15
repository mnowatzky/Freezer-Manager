import { Icon } from "./Icon";

/** Compact tonal badge-chip (e.g. container number). */
export function Chip({ icon, children, className = "" }: { icon?: string; children: React.ReactNode; className?: string }) {
  return (
    <span
      className={`type-label-large inline-flex h-8 shrink-0 items-center gap-1 rounded-s bg-tertiary-container pr-3 pl-2 text-on-tertiary-container ${className}`}
    >
      {icon && <Icon name={icon} size={18} />}
      {children}
    </span>
  );
}
