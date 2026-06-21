import { auth } from "@/auth";
import {
  listNotebooks,
  createNotebook,
  getNotebook,
  saveNotebook,
  trashNotebook,
  attachNotebook,
  listRevisions,
  saveRevision,
  restoreRevision,
  runCell,
  listNotebookPermissions,
  putNotebookPermission,
  deleteNotebookPermission,
  ApiClientError,
  type CreateNotebookInput,
} from "@/lib/api";
import type { Permission, PrincipalType } from "@/lib/types";

// BFF proxy for the notebooks workspace. The browser only ever calls
// /api/notebooks/...; this handler reads the Auth.js session, injects the Bearer
// token, and dispatches to the matching typed api.ts fn by the catch-all path
// shape + HTTP verb. Upstream status + body propagate unchanged.
//
// Export (GET /api/notebooks/{id}/export) is handled by a dedicated route that
// streams the file body, not this JSON proxy.
//
// Path shapes (segments after /api/notebooks):
//   []                                      GET list · POST create
//   [id]                                    GET detail · PUT save content · DELETE trash
//   [id, "attach"]                          POST attach {cluster_id}
//   [id, "revisions"]                       GET list · POST snapshot {message}
//   [id, "revisions", rev, "restore"]       POST restore
//   [id, "run"]                             POST run {cell_id?}
//   [id, "permissions"]                     GET list · PUT grant · DELETE revoke (?principal_type=&principal_id=)

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}
function notFound() {
  return Response.json({ error: { code: "not_found", message: "unknown notebook resource" } }, { status: 404 });
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
    if (path.length === 0) {
      return Response.json({ notebooks: await listNotebooks(tok) }, { status: 200 });
    }
    const [id, kw1] = path;
    if (path.length === 1) {
      return Response.json(await getNotebook(tok, id), { status: 200 });
    }
    if (path.length === 2 && kw1 === "revisions") {
      return Response.json({ revisions: await listRevisions(tok, id) }, { status: 200 });
    }
    if (path.length === 2 && kw1 === "permissions") {
      return Response.json({ permissions: await listNotebookPermissions(tok, id) }, { status: 200 });
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
    // [] → create
    if (path.length === 0) {
      const body = await readJson(req);
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (!name) return badRequest("name is required");
      const input: CreateNotebookInput = { name };
      if (typeof body.path === "string") input.path = body.path;
      if (body.folder_id === null || typeof body.folder_id === "string") input.folder_id = body.folder_id as string | null;
      if (body.content && typeof body.content === "object") input.content = body.content as CreateNotebookInput["content"];
      return Response.json(await createNotebook(tok, input), { status: 201 });
    }

    const [id, kw1, rev, kw2] = path;

    // [id, "attach"] → attach
    if (path.length === 2 && kw1 === "attach") {
      const body = await readJson(req);
      const clusterId = typeof body.cluster_id === "string" ? body.cluster_id.trim() : "";
      if (!clusterId) return badRequest("cluster_id is required");
      return Response.json(await attachNotebook(tok, id, clusterId), { status: 200 });
    }

    // [id, "revisions"] → snapshot
    if (path.length === 2 && kw1 === "revisions") {
      const body = await readJson(req);
      const message = typeof body.message === "string" ? body.message : "";
      return Response.json(await saveRevision(tok, id, message), { status: 201 });
    }

    // [id, "revisions", rev, "restore"] → restore
    if (path.length === 4 && kw1 === "revisions" && kw2 === "restore") {
      return Response.json(await restoreRevision(tok, id, rev), { status: 200 });
    }

    // [id, "run"] → run (cell or all). Currently relays a 501 from the API.
    if (path.length === 2 && kw1 === "run") {
      const body = await readJson(req);
      const runBody = typeof body.cell_id === "string" ? { cell_id: body.cell_id } : {};
      return Response.json(await runCell(tok, id, runBody), { status: 200 });
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
    const [id, kw1] = path;

    // [id] → save content
    if (path.length === 1) {
      const body = await readJson(req);
      if (!body.content || typeof body.content !== "object") return badRequest("content is required");
      return Response.json(await saveNotebook(tok, id, body.content as any), { status: 200 });
    }

    // [id, "permissions"] → grant
    if (path.length === 2 && kw1 === "permissions") {
      const body = await readJson(req);
      const perm = body as Partial<Permission>;
      if (!perm.principal_type || !perm.principal_id || !perm.level) {
        return badRequest("principal_type, principal_id and level are required");
      }
      await putNotebookPermission(tok, id, perm as Permission);
      return new Response(null, { status: 204 });
    }

    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  const tok = await token();
  if (!tok) return unauthenticated();
  const { path = [] } = await ctx.params;

  try {
    const [id, kw1] = path;

    // [id] → trash
    if (path.length === 1) {
      await trashNotebook(tok, id);
      return new Response(null, { status: 204 });
    }

    // [id, "permissions"] → revoke (principal in query)
    if (path.length === 2 && kw1 === "permissions") {
      const sp = new URL(req.url).searchParams;
      const pt = sp.get("principal_type");
      const pid = sp.get("principal_id");
      if (!pt || !pid) return badRequest("principal_type and principal_id query params are required");
      await deleteNotebookPermission(tok, id, pt as PrincipalType, pid);
      return new Response(null, { status: 204 });
    }

    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}
