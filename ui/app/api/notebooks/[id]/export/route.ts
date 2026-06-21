import { auth } from "@/auth";
import { notebookExport, ApiClientError } from "@/lib/api";

// Dedicated export route — distinct from the JSON catch-all because it streams a
// file download. It injects the Bearer token, asks the API for the .ipynb/.py
// file, and relays the upstream body verbatim, preserving content-type and
// content-disposition so the browser downloads with the right filename.

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

export async function GET(req: Request, ctx: Ctx) {
  const session = await auth();
  const token = (session as any)?.access_token;
  if (!token) return unauthenticated();

  const { id } = await ctx.params;
  const raw = new URL(req.url).searchParams.get("format");
  const format: "ipynb" | "py" = raw === "py" ? "py" : "ipynb";

  try {
    const upstream = await notebookExport(token, id, format);
    const headers = new Headers();
    const ct = upstream.headers.get("content-type");
    headers.set("content-type", ct ?? (format === "py" ? "text/x-python" : "application/x-ipynb+json"));
    // Preserve the upstream filename; synthesize a sensible one if absent so the
    // browser still downloads rather than rendering inline.
    const cd = upstream.headers.get("content-disposition");
    headers.set("content-disposition", cd ?? `attachment; filename="notebook.${format}"`);
    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return errResponse(e);
  }
}
