import type { BadgeKind } from "@/lib/types";
import type { ReactNode } from "react";

// Status badge with a small leading dot — an operator-console convention that
// reads faster than color alone. The `pending` dot pulses to signal in-flight.
const STYLES: Record<BadgeKind, { wrap: string; dot: string; pulse?: boolean }> = {
  ready: { wrap: "bg-accent-muted text-teal-800 ring-teal-600/20", dot: "bg-teal-600" },
  running: { wrap: "bg-sky-50 text-sky-700 ring-sky-600/20", dot: "bg-sky-500" },
  pending: { wrap: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500", pulse: true },
  failed: { wrap: "bg-rose-50 text-rose-700 ring-rose-600/20", dot: "bg-rose-500" },
  unknown: { wrap: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
};

export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  const s = STYLES[kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${s.wrap}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot} ${s.pulse ? "animate-pulse" : ""}`} aria-hidden />
      {children}
    </span>
  );
}
