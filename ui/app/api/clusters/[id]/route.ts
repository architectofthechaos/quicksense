import { auth } from "@/auth";
import { getCluster, deleteCluster, patchCluster, type ClusterPatch, ApiClientError } from "@/lib/api";
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

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  const { id } = await ctx.params;
  try {
    return Response.json(await getCluster(token, id), { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  const { id } = await ctx.params;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) ?? {};
  } catch {
    return Response.json({ error: { code: "invalid_json", message: "body must be JSON" } }, { status: 400 });
  }
  const patch: ClusterPatch = {};
  if (typeof body.pinned === "boolean") patch.pinned = body.pinned;
  if (body.config && typeof body.config === "object") patch.config = normalizeClusterConfig(body.config as any);

  try {
    return Response.json(await patchCluster(token, id, patch), { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  const { id } = await ctx.params;
  try {
    await deleteCluster(token, id);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errResponse(e);
  }
}
