import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { motionScheme } from "../theme/motion";

const ToastContext = createContext<(message: string) => void>(() => {});

/** M3 snackbar: inverse surface, slides up from the bottom on the spatial spring. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null);
  const counter = useRef(0);
  const show = useCallback((text: string) => {
    const id = ++counter.current;
    setMessage({ id, text });
    setTimeout(() => setMessage((cur) => (cur?.id === id ? null : cur)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-28 z-[60] flex justify-center">
        <AnimatePresence>
          {message && (
            <motion.div
              key={message.id}
              role="status"
              className="type-body-medium pointer-events-auto w-full max-w-md rounded-xs bg-inverse-surface px-4 py-3.5 text-inverse-on-surface shadow-lg"
              initial={{ opacity: 0, y: 24, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, transition: motionScheme.fastEffects }}
              transition={motionScheme.defaultSpatial}
            >
              {message.text}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
