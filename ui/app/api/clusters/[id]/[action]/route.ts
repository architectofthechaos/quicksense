import { auth } from "@/auth";
import {
  clusterLifecycle,
  cloneCluster,
  clusterEvents,
  clusterLogs,
  clusterMetrics,
  type LifecycleAction,
  ApiClientError,
} from "@/lib/api";

// Single passthrough handler for per-cluster sub-resources. POST drives the
// lifecycle/clone mutations; GET reads events/logs/metrics. The token is injected
// from the session; upstream status + body pass through unchanged.

const LIFECYCLE = new Set<LifecycleAction>(["start", "stop", "restart"]);
const GET_ACTIONS = new Set(["events", "logs", "metrics"]);

function unauthenticated() {
  return Response.json({ error: { code: "unauthenticated", message: "login required" } }, { status: 401 });
}
function notFound() {
  return Response.json({ error: { code: "not_found", message: "unknown action" } }, { status: 404 });
}
function errResponse(e: unknown) {
  if (e instanceof ApiClientError) {
    return Response.json({ error: { code: e.code ?? "upstream_error", message: e.message } }, { status: e.status });
  }
  return Response.json({ error: { code: "internal_error", message: "unexpected error" } }, { status: 500 });
}

type Ctx = { params: Promise<{ id: string; action: string }> };

export async function POST(req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  const { id, action } = await ctx.params;

  try {
    if (LIFECYCLE.has(action as LifecycleAction)) {
      return Response.json(await clusterLifecycle(token, id, action as LifecycleAction), { status: 200 });
    }
    if (action === "clone") {
      let name: string | undefined;
      try {
        const body = (await req.json()) as { name?: unknown } | null;
        if (body && typeof body.name === "string" && body.name.trim()) name = body.name.trim();
      } catch {
        // No/blank body → clone keeps the API's default naming.
      }
      return Response.json(await cloneCluster(token, id, name), { status: 201 });
    }
    return notFound();
  } catch (e) {
    return errResponse(e);
  }
}

export async function GET(_req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();
  const { id, action } = await ctx.params;
  if (!GET_ACTIONS.has(action)) return notFound();

  try {
    if (action === "events") {
      return Response.json({ events: await clusterEvents(token, id) }, { status: 200 });
    }
    if (action === "logs") {
      const text = await clusterLogs(token, id);
      return new Response(text, { status: 200, headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    // metrics
    return Response.json(await clusterMetrics(token, id), { status: 200 });
  } catch (e) {
    return errResponse(e);
  }
}
