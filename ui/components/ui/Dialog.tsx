"use client";
import { useEffect, type ReactNode } from "react";

// Accessible modal: role=dialog, Escape + backdrop click close, content click
// swallowed. Scrim fades in; card uses the elevated pop shadow. (SPEC-003.5 §4.4)
export function Dialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-base font-semibold tracking-tight text-foreground">{title}</h2>
        {children}
      </div>
    </div>
  );
}
