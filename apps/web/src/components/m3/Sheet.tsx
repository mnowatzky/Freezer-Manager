import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motionScheme } from "../../theme/motion";

/**
 * M3 modal bottom sheet (centered dialog on wide screens). Slides in on the default
 * spatial spring, can be dragged down to dismiss, and resizes smoothly when its
 * content changes. Controlled by `open` so the exit animation can play.
 */
export function Sheet({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  const drag = useDragControls();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    if (info.offset.y > 120 || info.velocity.y > 600) onClose();
  };

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
          <motion.div
            className="absolute inset-0 bg-scrim/40"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={motionScheme.defaultEffects}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal
            aria-label={typeof title === "string" ? title : undefined}
            className="relative max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface-container-low px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-xl"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%", transition: motionScheme.defaultEffects }}
            transition={motionScheme.defaultSpatial}
            drag="y"
            dragListener={false}
            dragControls={drag}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={onDragEnd}
            layout="size"
          >
            <div
              className="flex cursor-grab touch-none justify-center pt-3 pb-4 active:cursor-grabbing"
              onPointerDown={(e) => drag.start(e)}
            >
              <div className="h-1 w-8 rounded-full bg-on-surface-variant/40" />
            </div>
            <motion.h2 layout="position" className="type-headline-small mb-5">
              {title}
            </motion.h2>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
