import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { motionScheme } from "../theme/motion";

export type ToastAction = { label: string; onClick: () => void };
type Show = (text: string, action?: ToastAction) => void;

const ToastContext = createContext<Show>(() => {});

/**
 * M3 snackbar: inverse surface, slides up from the bottom on the spatial spring.
 * Rendered into <body> (outside #root, which is `inert` while a sheet is open) as a
 * permanently mounted live region, so screen readers announce every message.
 * With an action (e.g. "Undo") it stays a little longer and shows a focusable button.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string; action?: ToastAction } | null>(null);
  const counter = useRef(0);
  const show = useCallback<Show>((text, action) => {
    const id = ++counter.current;
    setMessage({ id, text, action });
    setTimeout(() => setMessage((cur) => (cur?.id === id ? null : cur)), action ? 6000 : 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {createPortal(
        <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-28 z-[60] flex justify-center">
          <AnimatePresence>
            {message && (
              <motion.div
                key={message.id}
                className="type-body-medium pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xs bg-inverse-surface py-1 pr-2 pl-4 text-inverse-on-surface shadow-lg"
                initial={{ opacity: 0, y: 24, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 12, transition: motionScheme.fastEffects }}
                transition={motionScheme.defaultSpatial}
              >
                <span className="min-w-0 flex-1 py-2.5">{message.text}</span>
                {message.action && (
                  <button
                    type="button"
                    className="state-layer type-label-large h-10 shrink-0 cursor-pointer rounded-full px-3 text-inverse-primary"
                    onClick={() => {
                      const { action } = message;
                      setMessage(null);
                      action?.onClick();
                    }}
                  >
                    {message.action.label}
                  </button>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
