import type { CSSProperties } from "react";

/**
 * Material Symbols Rounded (variable font, self-hosted subset).
 * Add new names to src/theme/icon-names.txt and re-download the font (README → Design).
 */
export function Icon({
  name,
  filled = false,
  size = 24,
  weight = 400,
  className = "",
  style,
}: {
  name: string;
  filled?: boolean;
  size?: number;
  weight?: number;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 select-none ${className}`}
      style={{
        fontFamily: '"Material Symbols Rounded"',
        fontSize: size,
        width: size,
        height: size,
        lineHeight: 1,
        fontFeatureSettings: '"liga"',
        fontVariationSettings: `"FILL" ${filled ? 1 : 0}, "wght" ${weight}, "GRAD" 0, "opsz" ${Math.min(48, Math.max(20, size))}`,
        // Fill/weight changes animate (e.g. selected state).
        transition: "font-variation-settings 200ms cubic-bezier(0.2, 0, 0, 1)",
        overflow: "hidden",
        ...style,
      }}
    >
      {name}
    </span>
  );
}
