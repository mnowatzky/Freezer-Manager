import { Icon } from "./Icon";

const tones = {
  tertiary: "bg-tertiary-container text-on-tertiary-container",
  error: "bg-error-container text-on-error-container",
};

/** Compact tonal badge-chip (e.g. container number). */
export function Chip({
  icon,
  tone = "tertiary",
  children,
  className = "",
}: {
  icon?: string;
  tone?: keyof typeof tones;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={`type-label-large inline-flex h-8 shrink-0 items-center gap-1 rounded-s pr-3 pl-2 ${tones[tone]} ${className}`}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </span>
  );
}
