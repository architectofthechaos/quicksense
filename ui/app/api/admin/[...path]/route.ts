import { auth } from "@/auth";
import {
  adminListUsers,
  adminCreateUser,
  adminAssignRole,
  adminListGroups,
  adminCreateGroup,
  ApiClientError,
} from "@/lib/api";

// BFF proxy for Identity & Access (Phase 4e). The browser only ever calls
// /api/admin/...; this handler reads the Auth.js session, injects the Bearer
// token, and dispatches to the matching typed api.ts fn by the catch-all path
// shape + HTTP verb. Upstream status + body propagate unchanged — crucially the
// 403 (caller lacks the quicksense_admin realm role) and 501 (Keycloak admin
// unconfigured) responses, which the view renders as distinct states.
//
// Path shapes (segments after /api/admin):
//   ["users"]                  GET list · POST create {username,email}
//   ["users", id, "roles"]     PUT assign {role}
//   ["groups"]                 GET list · POST create {name}

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}
function notFound() {
  return Response.json({ error: { code: "not_found", message: "unknown admin resource" } }, { status: 404 });
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

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(_req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { path = [] } = await ctx.params;

  try {
    // ["users"] → list users
    if (path.length === 1 && path[0] === "users") {
      return Response.json({ users: await adminListUsers(tok) }, { status: 200 });
    }
    // ["groups"] → list groups
    if (path.length === 1 && path[0] === "groups") {
      return Response.json({ groups: await adminListGroups(tok) }, { status: 200 });
    }
    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { path = [] } = await ctx.params;

  try {
    // ["users"] → create user {username, email}
    if (path.length === 1 && path[0] === "users") {
      const body = await readJson(req);
      const username = typeof body.username === "string" ? body.username.trim() : "";
      const email = typeof body.email === "string" ? body.email.trim() : "";
      if (!username) return badRequest("username is required");
      return Response.json(await adminCreateUser(tok, username, email), { status: 201 });
    }
    // ["groups"] → create group {name}
    if (path.length === 1 && path[0] === "groups") {
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return badRequest("name is required");
      return Response.json(await adminCreateGroup(tok, name), { status: 201 });
    }
    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { path = [] } = await ctx.params;

  try {
    // ["users", id, "roles"] → assign role {role}
    if (path.length === 3 && path[0] === "users" && path[2] === "roles") {
      const id = path[1];
      const body = await readJson(req);
      const role = typeof body.role === "string" ? body.role.trim() : "";
      if (!role) return badRequest("role is required");
      await adminAssignRole(tok, id, role);
      return new Response(null, { status: 204 });
    }
    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}
