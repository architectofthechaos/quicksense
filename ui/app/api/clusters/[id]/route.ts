import { auth } from "@/auth";
import { getCluster, deleteCluster, ApiClientError } from "@/lib/api";

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
