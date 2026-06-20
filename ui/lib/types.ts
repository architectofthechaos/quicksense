export type Cluster = {
  id: string;
  name: string;
  namespace: string;
  cr_name: string;
  phase: string;
  ready: boolean;
};

export type ClustersResponse = { clusters: Cluster[] };

export type ApiError = { error: { code: string; message: string } };

export type BadgeKind = "ready" | "running" | "pending" | "failed" | "unknown";

// phaseToBadge maps the API's (phase, ready) into a UI badge. `ready` always
// wins. Otherwise we key off the live CR state string, which is operator-defined
// and may be empty/"Unknown" — those degrade to "unknown" rather than a blank.
export function phaseToBadge(c: Pick<Cluster, "phase" | "ready">): { kind: BadgeKind; label: string } {
  if (c.ready) return { kind: "ready", label: "Ready" };
  const p = (c.phase ?? "").trim();
  const lower = p.toLowerCase();
  if (lower === "") return { kind: "unknown", label: "Unknown" };
  if (lower === "unknown") return { kind: "unknown", label: "Unknown" };
  if (lower.includes("running")) return { kind: "running", label: p };
  if (lower.includes("fail") || lower.includes("error")) return { kind: "failed", label: p };
  return { kind: "pending", label: p };
}

// isTerminalReady reports whether polling can stop (mirrors api-e2e semantics:
// ready === true || phase === "Running").
export function isTerminalReady(c: Pick<Cluster, "phase" | "ready">): boolean {
  return c.ready || c.phase === "Running";
}
