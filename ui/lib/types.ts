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

// ── Catalog (Phase 4c) ───────────────────────────────────────────────────────
// Iceberg/Polaris browse + table-detail shapes. All reads go through the Go API
// (the browser never touches Polaris/Trino directly).

// A catalog as returned by GET /v1/catalogs.
export type Catalog = { name: string; type: string };
export type CatalogsResponse = { catalogs: Catalog[] };

// A namespace within a catalog. `name` may be dot-joined for nested namespaces
// (e.g. "demo" or "analytics.sales").
export type CatalogNamespace = { name: string };
export type NamespacesResponse = { namespaces: CatalogNamespace[] };

// A table within a namespace. `namespace` echoes the (dot-joined) parent.
export type CatalogTable = { name: string; namespace: string };
export type TablesResponse = { tables: CatalogTable[] };

// One column of an Iceberg table schema.
export type TableColumn = { name: string; type: string; required: boolean; doc?: string };

// One snapshot in an Iceberg table's history.
export type TableSnapshot = { snapshot_id: string; timestamp_ms: number; operation: string };

// Full table detail from GET /v1/catalogs/{c}/namespaces/{ns}/tables/{t}.
export type TableDetail = {
  location: string;
  format: string;
  current_snapshot_id: string;
  columns: TableColumn[];
  partition_fields: string[];
  properties: Record<string, string>;
  snapshots: TableSnapshot[];
};

// Sample rows from GET …/tables/{t}/sample (via Trino). May be unavailable
// (HTTP 501) when Trino is unconfigured — the UI handles that gracefully.
export type TableSample = { columns: string[]; rows: unknown[][] };

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

// ── Notebooks (Phase 4d) ─────────────────────────────────────────────────────
// Notebook source lives as JSONB on the notebook: a list of typed cells. The
// browser holds the editable content; saves PUT the whole {cells:[]} back. All
// reads/writes route through the Go API via the BFF (browser never touches the
// data plane).

export type CellType = "code" | "markdown";

// One notebook cell. `id` is a client-stable identifier used as a React key and
// for reorder/run targeting; the API persists it as part of the JSONB content.
export type NotebookCell = { id: string; type: CellType; source: string };

// The persisted notebook body. The contract is `{cells:[{type,source}]}`; we
// additionally carry a per-cell `id` for stable UI keying.
export type NotebookContent = { cells: NotebookCell[] };

// A notebook as returned by list/CRUD endpoints. List responses omit `content`;
// GET /{id}, POST and PUT include it. `path` is the workspace path; `folder_id`
// and `attached_cluster_id` may be null.
export type Notebook = {
  id: string;
  name: string;
  path: string;
  folder_id: string | null;
  attached_cluster_id: string | null;
  created_at: string;
  updated_at: string;
  content?: NotebookContent;
};

// A lightweight summary used for the workspace list/tree (no content).
export type NotebookSummary = Omit<Notebook, "content">;

export type NotebooksResponse = { notebooks: NotebookSummary[] };

// One saved revision (version-history entry). `snapshot` content is not returned
// in the list; restore re-applies it server-side.
export type Revision = {
  id: string;
  message: string;
  author: string;
  created_at: string;
};

export type RevisionsResponse = { revisions: Revision[] };

// ── Run output framing (SSE) ─────────────────────────────────────────────────
// A run emits frames; the broker/API contract (design D5) is:
//   {type:'stdout', text}
//   {type:'result', columns:[], rows:[][]}
//   {type:'error', ename, evalue, traceback:[]}
// Execution is currently 501 (broker pending); the UI tolerates that and these
// shapes describe what a successful run *would* return so the renderer is ready.
export type RunOutput =
  | { type: "stdout"; text: string }
  | { type: "result"; columns: string[]; rows: unknown[][] }
  | { type: "error"; ename: string; evalue: string; traceback: string[] };

// Permission level for object sharing (mirrors the 4e permissions contract).
export type PermissionLevel = "view" | "run" | "edit" | "manage";
export type PrincipalType = "user" | "group";
export type Permission = {
  principal_type: PrincipalType;
  principal_id: string;
  level: PermissionLevel;
};
export type PermissionsResponse = { permissions: Permission[] };

let cellSeq = 0;
// newCell mints a fresh cell with a process-unique id. The id only needs to be
// stable within a session (it is a React key + reorder handle), so a monotonic
// counter combined with a random suffix is sufficient and test-deterministic.
export function newCell(type: CellType, source = ""): NotebookCell {
  cellSeq += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  return { id: `cell-${cellSeq}-${rand}`, type, source };
}

// moveCell returns a new cell array with the cell at `index` shifted one slot in
// `dir`. Out-of-range moves (first up / last down) are no-ops. Never mutates the
// input — callers can pass it straight to setState.
export function moveCell(cells: NotebookCell[], index: number, dir: "up" | "down"): NotebookCell[] {
  const target = dir === "up" ? index - 1 : index + 1;
  if (index < 0 || index >= cells.length || target < 0 || target >= cells.length) {
    return cells.slice();
  }
  const out = cells.slice();
  [out[index], out[target]] = [out[target], out[index]];
  return out;
}

// normalizeContent coerces an arbitrary (possibly partial / server-shaped)
// content blob into a complete NotebookContent: fills cell ids, defaults an
// unknown type to "code" and a missing source to "", and guarantees at least one
// cell so the editor always has something to render. The input is intentionally
// loose — it's the defensive boundary for whatever the API returns.
export function normalizeContent(
  input: { cells?: Array<Partial<NotebookCell>> } | null | undefined,
): NotebookContent {
  const rawCells = Array.isArray(input?.cells) ? input!.cells : [];
  const cells: NotebookCell[] = rawCells.map((c) => {
    const type: CellType = c?.type === "markdown" ? "markdown" : "code";
    const source = typeof c?.source === "string" ? c.source : "";
    const id = typeof c?.id === "string" && c.id.trim() ? c.id : newCell(type).id;
    return { id, type, source };
  });
  if (cells.length === 0) return emptyNotebookContent();
  return { cells };
}

// emptyNotebookContent is the starting body for a brand-new notebook: a single
// empty code cell.
export function emptyNotebookContent(): NotebookContent {
  return { cells: [newCell("code")] };
}

// notebookDisplayName resolves the label to show for a notebook: its explicit
// name, else the tail of its path, else "Untitled".
export function notebookDisplayName(n: Pick<NotebookSummary, "name" | "path">): string {
  if (n.name && n.name.trim()) return n.name.trim();
  const tail = (n.path ?? "").split("/").filter(Boolean).pop();
  return tail && tail.trim() ? tail : "Untitled";
}

// WorkspaceNode is the display tree the workspace pane renders. Folders are
// derived from notebook paths (the API stores a flat notebook list with paths);
// `notebookId` is set on notebook leaves so a selection maps back to the record.
export type WorkspaceNode = {
  id: string; // stable display id (folder path or "nb:<id>")
  label: string;
  kind: "folder" | "notebook";
  notebookId?: string;
  children?: WorkspaceNode[];
};

// buildWorkspaceTree groups a flat notebook list into a folder/notebook tree by
// splitting each notebook's path on "/". A path like "/Reports/Q1" places a
// notebook "Q1" inside a folder "Reports"; a bare "/scratch" is a top-level
// notebook. Folders sort before notebooks, each alphabetically (case-insensitive).
export function buildWorkspaceTree(notebooks: NotebookSummary[]): WorkspaceNode[] {
  type Dir = { folders: Map<string, Dir>; notebooks: WorkspaceNode[] };
  const root: Dir = { folders: new Map(), notebooks: [] };

  for (const n of notebooks) {
    const segs = (n.path ?? "").split("/").filter(Boolean);
    const name = notebookDisplayName(n);
    const folderSegs = segs.slice(0, -1); // last segment is the notebook itself
    let dir = root;
    for (const seg of folderSegs) {
      let child = dir.folders.get(seg);
      if (!child) {
        child = { folders: new Map(), notebooks: [] };
        dir.folders.set(seg, child);
      }
      dir = child;
    }
    dir.notebooks.push({ id: `nb:${n.id}`, label: name, kind: "notebook", notebookId: n.id });
  }

  const byLabel = (a: WorkspaceNode, b: WorkspaceNode) =>
    a.label.toLowerCase().localeCompare(b.label.toLowerCase());

  const toNodes = (dir: Dir, prefix: string): WorkspaceNode[] => {
    const folderNodes: WorkspaceNode[] = Array.from(dir.folders.entries())
      .map(([seg, child]) => {
        const path = `${prefix}/${seg}`;
        return { id: `dir:${path}`, label: seg, kind: "folder" as const, children: toNodes(child, path) };
      })
      .sort(byLabel);
    const notebookNodes = dir.notebooks.slice().sort(byLabel);
    return [...folderNodes, ...notebookNodes];
  };

  return toNodes(root, "");
}
