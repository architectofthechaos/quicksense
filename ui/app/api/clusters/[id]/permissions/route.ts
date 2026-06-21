import { auth } from "@/auth";
import { listPermissions, grantPermission, revokePermission, type GrantInput, ApiClientError } from "@/lib/api";
import type { PrincipalType } from "@/lib/types";

// BFF proxy for a cluster's object-level permissions (Phase 4e). Mirrors the
// notebooks permissions proxy (which rides the [...path] catch-all) but clusters
// need a dedicated route. The browser only calls /api/clusters/{id}/permissions;
// this reads the Auth.js session, injects the Bearer token, and dispatches to the
// generic permissions fns with kind "clusters". Upstream status + body propagate.
//
//   GET    → list grants                       → {permissions:[…]}
//   PUT    {principal_type,principal_id,level}  → grant (200 with the grant)
//   DELETE ?principal_type=&principal_id=       → revoke (204)

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}
function badRequest(message: string) {
  return Response.json({ error: { code: "invalid_request", message } }, { status: 400 });
}
function errResponse(e: unknown) {
  if (e instanceof ApiClientError) {
    return Response.json({ error: { code: e.code ?? "upstream_error", message: e.message } }, { status: e.status });
  }
  return Response.json({ error: { code: "internal_error", message: "unexpected error" } }, { status: 500 });
}

async function token(): Promise<string | null> {
  const session = await auth();
  return (session as any)?.access_token ?? null;
}

async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    return ((await req.json()) as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { id } = await ctx.params;
  try {
    return Response.json({ permissions: await listPermissions("clusters", id, tok) }, { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { id } = await ctx.params;

  const body = await readJson(req);
  const perm = body as Partial<GrantInput>;
  if (!perm.principal_type || !perm.principal_id || !perm.level) {
    return badRequest("principal_type, principal_id and level are required");
  }
  try {
    const grant = await grantPermission("clusters", id, perm as GrantInput, tok);
    return Response.json(grant, { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { id } = await ctx.params;

  const sp = new URL(req.url).searchParams;
  const pt = sp.get("principal_type");
  const pid = sp.get("principal_id");
  if (!pt || !pid) return badRequest("principal_type and principal_id query params are required");
  try {
    await revokePermission("clusters", id, pt as PrincipalType, pid, tok);
    return new Response(null, { status: 204 });
  } catch (e) {
    return errResponse(e);
  }
}
