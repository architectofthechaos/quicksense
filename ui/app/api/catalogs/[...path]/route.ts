import { auth } from "@/auth";
import {
  listCatalogs,
  listNamespaces,
  listTables,
  getTable,
  getTableSample,
  ApiClientError,
} from "@/lib/api";

// Read-only BFF proxy for the catalog browser. The browser only ever calls
// /api/catalogs/...; this handler reads the Auth.js session, injects the Bearer
// token, and dispatches to the matching typed api.ts fn by the catch-all path
// shape. GET only — every catalog endpoint is a read.
//
// Path shapes (segments after /api/catalogs):
//   []                                                  → list catalogs
//   [c, "namespaces"]                                   → list namespaces
//   [c, "namespaces", ns, "tables"]                     → list tables
//   [c, "namespaces", ns, "tables", t]                  → table detail
//   [c, "namespaces", ns, "tables", t, "sample"]        → sample rows (?limit=N)

const DEFAULT_SAMPLE_LIMIT = 100;

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}
function notFound() {
  return Response.json({ error: { code: "not_found", message: "unknown catalog resource" } }, { status: 404 });
}
function errResponse(e: unknown) {
  if (e instanceof ApiClientError) {
    return Response.json({ error: { code: e.code ?? "upstream_error", message: e.message } }, { status: e.status });
  }
  return Response.json({ error: { code: "internal_error", message: "unexpected error" } }, { status: 500 });
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();

  const { path = [] } = await ctx.params;

  try {
    // [] → catalogs
    if (path.length === 0) {
      return Response.json({ catalogs: await listCatalogs(token) }, { status: 200 });
    }

    const [catalog, kw1, ns, kw2, table, kw3] = path;

    // [c, "namespaces"] → namespaces
    if (path.length === 2 && kw1 === "namespaces") {
      return Response.json({ namespaces: await listNamespaces(token, catalog) }, { status: 200 });
    }

    if (path.length >= 4 && kw1 === "namespaces" && kw2 === "tables") {
      // [c, "namespaces", ns, "tables"] → tables
      if (path.length === 4) {
        return Response.json({ tables: await listTables(token, catalog, ns) }, { status: 200 });
      }
      // [c, "namespaces", ns, "tables", t] → table detail
      if (path.length === 5) {
        return Response.json(await getTable(token, catalog, ns, table), { status: 200 });
      }
      // [c, "namespaces", ns, "tables", t, "sample"] → sample rows
      if (path.length === 6 && kw3 === "sample") {
        const raw = new URL(req.url).searchParams.get("limit");
        const parsed = raw === null ? NaN : Number(raw);
        const limit = Number.isFinite(parsed) && parsed > 0 ? Math.trunc(parsed) : DEFAULT_SAMPLE_LIMIT;
        return Response.json(await getTableSample(token, catalog, ns, table, limit), { status: 200 });
      }
    }

    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}
