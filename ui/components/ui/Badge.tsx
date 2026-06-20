import type { BadgeKind } from "@/lib/types";
import type { ReactNode } from "react";

// Status badge: token-tinted pill with a leading status dot. Provisioning/
// pending pulses (disabled under prefers-reduced-motion via globals.css).
const MAP: Record<BadgeKind, { cls: string; dot: string; pulse?: boolean }> = {
  ready: { cls: "badge-success", dot: "bg-success" },
  running: { cls: "badge-success", dot: "bg-success" },
  pending: { cls: "badge-warning", dot: "bg-warning", pulse: true },
  failed: { cls: "badge-error", dot: "bg-error" },
  unknown: { cls: "badge-unknown", dot: "bg-faint" },
};

export function Badge({ kind, children }: { kind: BadgeKind; children: ReactNode }) {
  const m = MAP[kind];
  return (
    <span className={`badge ${m.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${m.dot} ${m.pulse ? "animate-dot-pulse" : ""}`} aria-hidden />
      {children}
    </span>
  );
}
