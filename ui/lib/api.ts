import type {
  Cluster,
  ClustersResponse,
  ClusterConfig,
  ClusterEvent,
  ClusterEventsResponse,
  ClusterMetrics,
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
