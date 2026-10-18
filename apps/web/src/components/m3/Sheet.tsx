import { AnimatePresence, motion, useDragControls, type PanInfo } from "motion/react";
import { t } from "../../lib/i18n";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motionScheme } from "../../theme/motion";
import { IconButton } from "./Button";

// The element that last had focus inside the app (#root). Recorded on every focusin, i.e.
// before an autofocused field inside a newly opened sheet takes focus, so closing the sheet
// can hand focus back to whatever opened it.
let lastAppFocus: HTMLElement | null = null;
if (typeof document !== "undefined") {
  document.addEventListener("focusin", (e) => {
    const root = document.getElementById("root");
    if (e.target instanceof HTMLElement && root?.contains(e.target)) lastAppFocus = e.target;
  });
}

/**
 * M3 modal bottom sheet (centered dialog on wide screens). Slides in on the default
 * spatial spring, can be dragged down to dismiss, and resizes smoothly when its
 * content changes. Controlled by `open` so the exit animation can play.
 *
 * Accessibility: labelled by its heading, focus moves into the sheet on open and back to
 * the previously focused element on close, the app behind it is `inert` (so focus and
 * screen readers stay inside), and there is always a visible close button.
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
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

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

  // Focus management: move focus in (unless a field inside autofocused), make the app inert,
  // and restore focus to the opener when the sheet closes.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const opener = active instanceof HTMLElement && document.getElementById("root")?.contains(active) ? active : lastAppFocus;
    const root = document.getElementById("root");
    if (root) root.inert = true;
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      if (dialog && !dialog.contains(document.activeElement)) dialog.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (root) root.inert = false;
      if (opener?.isConnected) opener.focus();
    };
  }, [open]);

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
            ref={dialogRef}
            role="dialog"
            aria-modal
            aria-labelledby={titleId}
            tabIndex={-1}
            className="relative outline-none max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-xl bg-surface-container-low px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-xl"
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
            <motion.div layout="position" className="mb-5 flex items-start gap-2">
              <h2 id={titleId} className="type-headline-small min-w-0 flex-1">
                {title}
              </h2>
              <IconButton icon="close" label={t.common.close} className="-mt-1 -mr-2" onClick={onClose} />
            </motion.div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
