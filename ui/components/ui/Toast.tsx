"use client";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

type ToastItem = { id: number; message: string };

const ToastCtx = createContext<{ toast: (message: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}

let nextId = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string) => {
    const id = ++nextId;
    setToasts((t) => [...t, { id, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2600);
  }, []);

  return (
    <ToastCtx.Provider value={{ toast }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex flex-col items-end gap-2" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className="pointer-events-auto flex animate-toast-in items-center gap-2 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-sm font-medium text-foreground shadow-pop"
          >
            <Check className="h-4 w-4 text-success" />
            {t.message}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
