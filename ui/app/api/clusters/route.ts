import { auth } from "@/auth";
import { listClusters, createClusterFull, ApiClientError } from "@/lib/api";
import { normalizeClusterConfig } from "@/lib/types";

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}

function errResponse(e: unknown) {
  if (e instanceof ApiClientError) {
    return Response.json({ error: { code: e.code ?? "upstream_error", message: e.message } }, { status: e.status });
  }
  return Response.json({ error: { code: "internal_error", message: "unexpected error" } }, { status: 500 });
}

export async function GET() {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  try {
    const clusters = await listClusters(token);
    return Response.json({ clusters }, { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: Request) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();

  let raw: Record<string, unknown>;
  try {
    raw = (await req.json()) ?? {};
  } catch {
    return Response.json({ error: { code: "invalid_json", message: "body must be JSON" } }, { status: 400 });
  }
  // Normalize the (possibly partial) body into a complete config so the upstream
  // contract is always satisfied; name is required either way.
  const config = normalizeClusterConfig(raw);
  if (!config.name) {
    return Response.json({ error: { code: "missing_name", message: "name is required" } }, { status: 400 });
  }
  try {
    const cluster = await createClusterFull(token, config);
    return Response.json(cluster, { status: 201 });
  } catch (e) {
    return errResponse(e);
  }
}
