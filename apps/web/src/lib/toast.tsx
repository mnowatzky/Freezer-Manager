import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

const ToastContext = createContext<(message: string) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    setTimeout(() => setMessage((cur) => (cur === m ? null : cur)), 4000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {message && (
        <div className="fixed inset-x-4 bottom-24 z-50 mx-auto max-w-md rounded-lg bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
          {message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
