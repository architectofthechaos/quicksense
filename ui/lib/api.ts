import type { Cluster, ClustersResponse, ApiError } from "@/lib/types";

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
