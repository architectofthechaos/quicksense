// ResourceSpec captures a pod container's CPU + memory request/limit as the
// free-text Kubernetes quantity strings the Go API expects (e.g. "500m", "2Gi").
export type ResourceSpec = {
  cpu_request: string;
  cpu_limit: string;
  memory_request: string;
  memory_limit: string;
};

// ClusterConfig mirrors the POST /v1/clusters create body 1:1. The same shape is
// echoed back on a cluster as `config`, and is the payload for PATCH `config`.
export type ClusterConfig = {
  name: string;
  worker_min: number;
  worker_max: number;
  driver: ResourceSpec;
  executor: ResourceSpec;
  image: string;
  idle_minutes: number;
  spark_conf: Record<string, string>;
  env: Record<string, string>;
  tags: Record<string, string>;
};

export type Cluster = {
  id: string;
  name: string;
  namespace: string;
  cr_name: string;
  phase: string;
  ready: boolean;
  pinned?: boolean;
  desired_state?: string;
  config?: ClusterConfig;
  // Optional creation timestamp used to render the "Age" column. Not all API
  // responses carry it; the UI degrades to "—" when absent.
  created_at?: string;
};

export type ClustersResponse = { clusters: Cluster[] };

// ClusterEvent is one translated CR/pod event from GET /clusters/{id}/events.
export type ClusterEvent = {
  type: string;
  reason: string;
  message: string;
  object: string;
  count: number;
  last_seen: string;
};

export type ClusterEventsResponse = { events: ClusterEvent[] };

// ClusterMetrics is best-effort, from metrics-server. When the server is absent
// the API returns `{available:false}` and omits `pods`.
export type PodMetrics = { name: string; cpu: string; memory: string };
export type ClusterMetrics = { available: boolean; pods?: PodMetrics[] };

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
// ready === true || phase === "Running"). A Stopped cluster is also terminal —
// it has no CR to settle, so we should not poll it forever.
export function isTerminalReady(c: Pick<Cluster, "phase" | "ready" | "desired_state">): boolean {
  if (c.desired_state === "Stopped") return true;
  return c.ready || c.phase === "Running";
}

// defaultResourceSpec — conservative single-node-friendly container sizing.
export function defaultResourceSpec(): ResourceSpec {
  return { cpu_request: "500m", cpu_limit: "1", memory_request: "1Gi", memory_limit: "2Gi" };
}

// defaultClusterConfig is the single source of truth for create-form initial
// values and for filling a partial body server-side, so the upstream contract is
// always complete regardless of which client path produced it.
export function defaultClusterConfig(name = ""): ClusterConfig {
  return {
    name,
    worker_min: 1,
    worker_max: 2,
    driver: defaultResourceSpec(),
    executor: defaultResourceSpec(),
    image: "",
    idle_minutes: 30,
    spark_conf: {},
    env: {},
    tags: {},
  };
}

// normalizeClusterConfig coerces an arbitrary (possibly partial) input into a
// complete ClusterConfig: trims the name, fills resources/maps, and clamps the
// numeric fields. Used by the create-form serializer and the BFF POST handler.
export function normalizeClusterConfig(input: Partial<ClusterConfig> & { name?: unknown }): ClusterConfig {
  const base = defaultClusterConfig();
  const num = (v: unknown, d: number) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  };
  const res = (r: Partial<ResourceSpec> | undefined): ResourceSpec => ({
    cpu_request: (r?.cpu_request ?? base.driver.cpu_request).toString().trim(),
    cpu_limit: (r?.cpu_limit ?? base.driver.cpu_limit).toString().trim(),
    memory_request: (r?.memory_request ?? base.driver.memory_request).toString().trim(),
    memory_limit: (r?.memory_limit ?? base.driver.memory_limit).toString().trim(),
  });
  const strMap = (m: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (m && typeof m === "object") {
      for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
        const key = k.trim();
        if (key) out[key] = v == null ? "" : String(v);
      }
    }
    return out;
  };
  const workerMin = Math.max(0, Math.trunc(num(input.worker_min, base.worker_min)));
  const workerMax = Math.max(workerMin, Math.trunc(num(input.worker_max, Math.max(workerMin, base.worker_max))));
  return {
    name: typeof input.name === "string" ? input.name.trim() : "",
    worker_min: workerMin,
    worker_max: workerMax,
    driver: res(input.driver),
    executor: res(input.executor),
    image: (input.image ?? "").toString().trim(),
    idle_minutes: Math.max(0, Math.trunc(num(input.idle_minutes, base.idle_minutes))),
    spark_conf: strMap(input.spark_conf),
    env: strMap(input.env),
    tags: strMap(input.tags),
  };
}

// connectUrl builds the Spark Connect endpoint for a cluster. The Spark Operator
// names the gRPC Service "<cr-name>-server" on port 15002 (verified live).
export function connectUrl(crName: string): string {
  return `sc://${crName}-server:15002`;
}

// formatAge renders a compact relative age ("3m", "5h", "2d") from an ISO
// timestamp. Returns "—" for missing/unparseable input so the table stays tidy.
export function formatAge(iso: string | undefined, now: number = Date.now()): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const secs = Math.max(0, Math.floor((now - t) / 1000));
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// resourceSummary renders a one-line "cpu req→limit / mem req→limit" summary for
// a container, e.g. "500m→1 · 1Gi→2Gi". Used in the table's compact resource col.
export function resourceSummary(r: ResourceSpec | undefined): string {
  if (!r) return "—";
  return `${r.cpu_request || "—"}→${r.cpu_limit || "—"} · ${r.memory_request || "—"}→${r.memory_limit || "—"}`;
}
