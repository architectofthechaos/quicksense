import type {
  Cluster,
  ClustersResponse,
  ClusterConfig,
  ClusterEvent,
  ClusterEventsResponse,
  ClusterMetrics,
  Catalog,
  CatalogsResponse,
  CatalogNamespace,
  NamespacesResponse,
  CatalogTable,
  TablesResponse,
  TableDetail,
  TableSample,
  Notebook,
  NotebookSummary,
  NotebooksResponse,
  NotebookContent,
  Revision,
  RevisionsResponse,
  Permission,
  PermissionsResponse,
  PrincipalType,
  KcUser,
  KcUsersResponse,
  KcGroup,
  KcGroupsResponse,
  ApiError,
} from "@/lib/types";

// ApiClientError carries the upstream HTTP status + machine code so route
// handlers can propagate them to the browser.
export class ApiClientError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
  }
}

function baseUrl(): string {
  const b = process.env.QUICKSENSE_API_BASE_URL;
  if (!b) throw new Error("QUICKSENSE_API_BASE_URL is not set");
  return b.replace(/\/$/, "");
}

// apiFetch is the single seam to the Go control-plane API. It runs server-side
// only and injects the caller's Keycloak access token as a Bearer header.
export async function apiFetch(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers ?? {}),
    },
    cache: "no-store",
  });
}

async function asError(res: Response): Promise<ApiClientError> {
  let code: string | undefined;
  let message = `API error ${res.status}`;
  try {
    const body = (await res.json()) as ApiError;
    if (body?.error) {
      code = body.error.code;
      message = body.error.message || message;
    }
  } catch {
    // Non-JSON error body (e.g. plain "Unauthorized" from the auth middleware).
  }
  return new ApiClientError(message, res.status, code);
}

export async function listClusters(token: string): Promise<Cluster[]> {
  const res = await apiFetch("/v1/clusters", token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as ClustersResponse;
  return body.clusters ?? [];
}

export async function createCluster(token: string, name: string): Promise<Cluster> {
  const res = await apiFetch("/v1/clusters", token, { method: "POST", body: JSON.stringify({ name }) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export async function getCluster(token: string, id: string): Promise<Cluster> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}`, token);
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export async function deleteCluster(token: string, id: string): Promise<void> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}`, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

// createClusterFull POSTs the complete production-cluster config (pod resources,
// autoscaling, image, idle, spark_conf/env/tags) — distinct from the minimal
// name-only createCluster kept for the legacy quick-create path.
export async function createClusterFull(token: string, config: ClusterConfig): Promise<Cluster> {
  const res = await apiFetch("/v1/clusters", token, { method: "POST", body: JSON.stringify(config) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export type ClusterPatch = { pinned?: boolean; config?: ClusterConfig };

export async function patchCluster(token: string, id: string, body: ClusterPatch): Promise<Cluster> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}`, token, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export type LifecycleAction = "start" | "stop" | "restart";

export async function clusterLifecycle(token: string, id: string, action: LifecycleAction): Promise<Cluster> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}/${action}`, token, { method: "POST" });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export async function cloneCluster(token: string, id: string, name?: string): Promise<Cluster> {
  const body = name ? { name } : {};
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}/clone`, token, {
    method: "POST",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Cluster;
}

export async function clusterEvents(token: string, id: string): Promise<ClusterEvent[]> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}/events`, token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as ClusterEventsResponse;
  return body.events ?? [];
}

// clusterLogs returns the driver pod's logs as plain text (text/plain upstream).
export async function clusterLogs(token: string, id: string): Promise<string> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}/logs`, token);
  if (!res.ok) throw await asError(res);
  return res.text();
}

export async function clusterMetrics(token: string, id: string): Promise<ClusterMetrics> {
  const res = await apiFetch(`/v1/clusters/${encodeURIComponent(id)}/metrics`, token);
  if (!res.ok) throw await asError(res);
  return (await res.json()) as ClusterMetrics;
}

// ── Catalog (Phase 4c) ───────────────────────────────────────────────────────
// Read-only Iceberg/Polaris browse + table detail. Each fn maps 1:1 to a Go
// endpoint under /v1/catalogs and unwraps its envelope. Path segments are
// URL-encoded; dot-joined namespaces (e.g. "analytics.sales") pass through as a
// single segment, matching the Go contract.

export async function listCatalogs(token: string): Promise<Catalog[]> {
  const res = await apiFetch("/v1/catalogs", token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as CatalogsResponse;
  return body.catalogs ?? [];
}

export async function listNamespaces(token: string, catalog: string): Promise<CatalogNamespace[]> {
  const res = await apiFetch(`/v1/catalogs/${encodeURIComponent(catalog)}/namespaces`, token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as NamespacesResponse;
  return body.namespaces ?? [];
}

export async function listTables(token: string, catalog: string, namespace: string): Promise<CatalogTable[]> {
  const res = await apiFetch(
    `/v1/catalogs/${encodeURIComponent(catalog)}/namespaces/${encodeURIComponent(namespace)}/tables`,
    token,
  );
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as TablesResponse;
  return body.tables ?? [];
}

export async function getTable(
  token: string,
  catalog: string,
  namespace: string,
  table: string,
): Promise<TableDetail> {
  const res = await apiFetch(
    `/v1/catalogs/${encodeURIComponent(catalog)}/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(table)}`,
    token,
  );
  if (!res.ok) throw await asError(res);
  return (await res.json()) as TableDetail;
}

// getTableSample fetches top-N rows via Trino. The caller is expected to handle
// a thrown ApiClientError with status 501 (Trino unconfigured) as a graceful
// "sample unavailable" state.
export async function getTableSample(
  token: string,
  catalog: string,
  namespace: string,
  table: string,
  limit: number,
): Promise<TableSample> {
  const res = await apiFetch(
    `/v1/catalogs/${encodeURIComponent(catalog)}/namespaces/${encodeURIComponent(namespace)}/tables/${encodeURIComponent(table)}/sample?limit=${encodeURIComponent(String(limit))}`,
    token,
  );
  if (!res.ok) throw await asError(res);
  return (await res.json()) as TableSample;
}

// ── Notebooks (Phase 4d) ───────────────────────────────────────────────────────
// Workspace notebooks: list/CRUD, attach-to-cluster, version history, run (cell
// execution — currently 501), object-level share permissions, and export. Each
// fn maps 1:1 to a Go endpoint under /v1/notebooks and unwraps its envelope; the
// browser reaches these only through the BFF route handlers.

const nbPath = (id: string) => `/v1/notebooks/${encodeURIComponent(id)}`;

export async function listNotebooks(token: string): Promise<NotebookSummary[]> {
  const res = await apiFetch("/v1/notebooks", token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as NotebooksResponse;
  return body.notebooks ?? [];
}

// CreateNotebookInput mirrors the POST body. Only `name` is required; `path`,
// `folder_id` and starting `content` are optional. Undefined fields are omitted
// from the JSON so the API can apply its defaults.
export type CreateNotebookInput = {
  name: string;
  path?: string;
  folder_id?: string | null;
  content?: NotebookContent;
};

export async function createNotebook(token: string, input: CreateNotebookInput): Promise<Notebook> {
  const body: Record<string, unknown> = { name: input.name };
  if (input.path !== undefined) body.path = input.path;
  if (input.folder_id !== undefined) body.folder_id = input.folder_id;
  if (input.content !== undefined) body.content = input.content;
  const res = await apiFetch("/v1/notebooks", token, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Notebook;
}

export async function getNotebook(token: string, id: string): Promise<Notebook> {
  const res = await apiFetch(nbPath(id), token);
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Notebook;
}

export async function saveNotebook(token: string, id: string, content: NotebookContent): Promise<Notebook> {
  const res = await apiFetch(nbPath(id), token, { method: "PUT", body: JSON.stringify({ content }) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Notebook;
}

export async function trashNotebook(token: string, id: string): Promise<void> {
  const res = await apiFetch(nbPath(id), token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

export async function attachNotebook(token: string, id: string, clusterId: string): Promise<Notebook> {
  const res = await apiFetch(`${nbPath(id)}/attach`, token, {
    method: "POST",
    body: JSON.stringify({ cluster_id: clusterId }),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Notebook;
}

export async function listRevisions(token: string, id: string): Promise<Revision[]> {
  const res = await apiFetch(`${nbPath(id)}/revisions`, token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as RevisionsResponse;
  return body.revisions ?? [];
}

export async function saveRevision(token: string, id: string, message: string): Promise<Revision> {
  const res = await apiFetch(`${nbPath(id)}/revisions`, token, { method: "POST", body: JSON.stringify({ message }) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Revision;
}

export async function restoreRevision(token: string, id: string, rev: string): Promise<Notebook> {
  const res = await apiFetch(`${nbPath(id)}/revisions/${encodeURIComponent(rev)}/restore`, token, { method: "POST" });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as Notebook;
}

// RunRequest selects what to execute. An empty body runs all cells; `cell_id`
// runs a single cell. The endpoint is currently 501 (Spark-Connect broker
// pending) — callers should catch the ApiClientError (code "execution_unavailable")
// and surface a graceful "execution not yet available" state.
export type RunRequest = { cell_id?: string };

export async function runCell(token: string, id: string, body: RunRequest): Promise<unknown> {
  const res = await apiFetch(`${nbPath(id)}/run`, token, { method: "POST", body: JSON.stringify(body) });
  if (!res.ok) throw await asError(res);
  return res.json();
}

export async function listNotebookPermissions(token: string, id: string): Promise<Permission[]> {
  const res = await apiFetch(`${nbPath(id)}/permissions`, token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as PermissionsResponse;
  return body.permissions ?? [];
}

export async function putNotebookPermission(token: string, id: string, perm: Permission): Promise<void> {
  const res = await apiFetch(`${nbPath(id)}/permissions`, token, { method: "PUT", body: JSON.stringify(perm) });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

export async function deleteNotebookPermission(
  token: string,
  id: string,
  principalType: PrincipalType,
  principalId: string,
): Promise<void> {
  const qs = `principal_type=${encodeURIComponent(principalType)}&principal_id=${encodeURIComponent(principalId)}`;
  const res = await apiFetch(`${nbPath(id)}/permissions?${qs}`, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

// ── Generic object-level permissions (Phase 4e) ──────────────────────────────
// One set of fns serves both clusters and notebooks; `kind` selects the path
// segment ("clusters" | "notebooks"). The Go contract is shared:
//   GET    /v1/{kind}/{id}/permissions → {object_type, permissions:[…]}
//   PUT    /v1/{kind}/{id}/permissions  {principal_type,principal_id,level} → grant
//   DELETE /v1/{kind}/{id}/permissions?principal_type=&principal_id= → 204
// `token` is last (not first like the older fns) so the call site reads
// kind-first, matching the component's props; it is still injected server-side.

export type PermissionKind = "clusters" | "notebooks";

// GrantInput is the PUT body. `level` is a free string here because valid values
// differ per kind (cluster: attach|manage; notebook: view|run|edit|manage); the
// API is the source of truth and rejects an invalid level with 400.
export type GrantInput = { principal_type: PrincipalType; principal_id: string; level: string };

const permPath = (kind: PermissionKind, id: string) => `/v1/${kind}/${encodeURIComponent(id)}/permissions`;

export async function listPermissions(kind: PermissionKind, id: string, token: string): Promise<Permission[]> {
  const res = await apiFetch(permPath(kind, id), token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as PermissionsResponse;
  return body.permissions ?? [];
}

// grantPermission PUTs a grant. On 200 it returns the parsed grant; a 204
// (no body) resolves to null. A non-ok/non-204 (e.g. 400 invalid level) throws.
export async function grantPermission(
  kind: PermissionKind,
  id: string,
  input: GrantInput,
  token: string,
): Promise<Permission | null> {
  const res = await apiFetch(permPath(kind, id), token, { method: "PUT", body: JSON.stringify(input) });
  if (!res.ok && res.status !== 204) throw await asError(res);
  if (res.status === 204) return null;
  return (await res.json()) as Permission;
}

export async function revokePermission(
  kind: PermissionKind,
  id: string,
  principalType: PrincipalType,
  principalId: string,
  token: string,
): Promise<void> {
  const qs = `principal_type=${encodeURIComponent(principalType)}&principal_id=${encodeURIComponent(principalId)}`;
  const res = await apiFetch(`${permPath(kind, id)}?${qs}`, token, { method: "DELETE" });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

// ── Identity & Access (Phase 4e) ─────────────────────────────────────────────
// Keycloak-admin: list/create realm users + groups, assign a realm role to a
// user. Each fn maps 1:1 to a Go endpoint under /v1/admin and unwraps its
// envelope. Every endpoint requires the quicksense_admin realm role (else 403)
// and returns 501 when Keycloak admin is unconfigured — both surface as an
// ApiClientError carrying that status so the UI renders distinct states. The
// browser reaches these only through the BFF.

export async function adminListUsers(token: string): Promise<KcUser[]> {
  const res = await apiFetch("/v1/admin/users", token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as KcUsersResponse;
  return body.users ?? [];
}

export async function adminCreateUser(token: string, username: string, email: string): Promise<KcUser> {
  const res = await apiFetch("/v1/admin/users", token, {
    method: "POST",
    body: JSON.stringify({ username, email }),
  });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as KcUser;
}

// adminAssignRole assigns a realm role to a user. Returns 204 (no body); a
// non-ok/non-204 throws.
export async function adminAssignRole(token: string, userId: string, role: string): Promise<void> {
  const res = await apiFetch(`/v1/admin/users/${encodeURIComponent(userId)}/roles`, token, {
    method: "PUT",
    body: JSON.stringify({ role }),
  });
  if (!res.ok && res.status !== 204) throw await asError(res);
}

export async function adminListGroups(token: string): Promise<KcGroup[]> {
  const res = await apiFetch("/v1/admin/groups", token);
  if (!res.ok) throw await asError(res);
  const body = (await res.json()) as KcGroupsResponse;
  return body.groups ?? [];
}

export async function adminCreateGroup(token: string, name: string): Promise<KcGroup> {
  const res = await apiFetch("/v1/admin/groups", token, { method: "POST", body: JSON.stringify({ name }) });
  if (!res.ok) throw await asError(res);
  return (await res.json()) as KcGroup;
}

// notebookExportUrl builds the *browser-facing* BFF export URL (not the upstream
// path). The export route streams the upstream file + content-disposition; the
// UI just points a download link at this.
export function notebookExportUrl(id: string, format: "ipynb" | "py"): string {
  return `/api/notebooks/${encodeURIComponent(id)}/export?format=${format}`;
}

// notebookExport returns the raw upstream Response so the BFF export route can
// stream the file body + content-disposition straight through. Unlike the other
// fns it does not unwrap JSON — the body is a file download. Throws on a non-ok
// status so the route can map it to an error envelope.
export async function notebookExport(token: string, id: string, format: "ipynb" | "py"): Promise<Response> {
  const res = await apiFetch(`${nbPath(id)}/export?format=${encodeURIComponent(format)}`, token);
  if (!res.ok) throw await asError(res);
  return res;
}
