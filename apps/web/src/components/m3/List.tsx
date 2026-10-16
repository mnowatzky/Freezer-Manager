import { motion } from "motion/react";
import type { ReactNode } from "react";
import { motionScheme } from "../../theme/motion";

/**
 * M3 Expressive segmented list: items are separate tiles with small inner corners
 * and large outer corners. Items animate in/out and reflow on the spatial spring,
 * which makes live-synced changes from other people visible.
 */
export function ListGroup({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <ul className={`flex flex-col gap-0.5 ${className}`}>{children}</ul>;
}

export function ListItem({
  headline,
  supporting,
  leading,
  trailing,
  onClick,
}: {
  headline: ReactNode;
  supporting?: ReactNode;
  leading?: ReactNode;
  trailing?: ReactNode;
  onClick?: () => void;
}) {
  const content = (
    <>
      {leading}
      <div className="min-w-0 flex-1">
        <div className="type-body-large truncate text-on-surface">{headline}</div>
        {supporting && <div className="type-body-medium truncate text-on-surface-variant">{supporting}</div>}
      </div>
      {trailing}
    </>
  );
  return (
    <motion.li
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96, transition: motionScheme.fastEffects }}
      transition={motionScheme.defaultSpatial}
      className="overflow-hidden rounded-xs bg-surface-container-lowest first:rounded-t-li last:rounded-b-li dark:bg-surface-container"
    >
      {onClick ? (
        <motion.button
          type="button"
          onClick={onClick}
          className="state-layer flex min-h-18 w-full cursor-pointer items-center gap-4 px-4 py-3 text-left"
          whileTap={{ scale: 0.985 }}
          transition={motionScheme.fastSpatial}
        >
          {content}
        </motion.button>
      ) : (
        <div className="flex min-h-18 items-center gap-4 px-4 py-3">{content}</div>
      )}
    </motion.li>
  );
}
