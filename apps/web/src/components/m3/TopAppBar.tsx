import { motion, useMotionValueEvent, useScroll, useTransform } from "motion/react";
import { useState, type ReactNode } from "react";
import { motionScheme } from "../../theme/motion";

/**
 * M3 medium flexible top app bar. The large headline scrolls away while a compact
 * title fades into the bar, and the bar tints to surface-container over content.
 */
export function TopAppBar({
  title,
  subtitle,
  navigation,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  navigation?: ReactNode;
  actions?: ReactNode;
}) {
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 4));
  const compactOpacity = useTransform(scrollY, [48, 80], [0, 1]);
  const compactY = useTransform(scrollY, [48, 80], [8, 0]);
  const expandedOpacity = useTransform(scrollY, [0, 56], [1, 0]);
  const expandedScale = useTransform(scrollY, [0, 56], [1, 0.92]);

  return (
    <>
      <motion.header
        className="sticky top-0 z-30 flex items-center gap-1 px-1 pt-[env(safe-area-inset-top)]"
        initial={false}
        animate={{
          backgroundColor: scrolled ? "var(--md-sys-color-surface-container)" : "var(--md-sys-color-surface)",
        }}
        transition={motionScheme.defaultEffects}
      >
        <div className="flex h-16 w-full items-center gap-1">
          {navigation ?? <div className="w-3" />}
          <motion.div
            className="type-title-large min-w-0 flex-1 truncate px-1"
            style={{ opacity: compactOpacity, y: compactY }}
            aria-hidden
          >
            {title}
          </motion.div>
          <div className="flex items-center gap-1 pr-1">{actions}</div>
        </div>
      </motion.header>
      <motion.div className="origin-left px-4 pt-1 pb-4" style={{ opacity: expandedOpacity, scale: expandedScale }}>
        <h1 className="type-headline-large type-emphasized line-clamp-2 break-words hyphens-auto">{title}</h1>
        {subtitle && <div className="type-body-medium mt-0.5 text-on-surface-variant">{subtitle}</div>}
      </motion.div>
    </>
  );
}
