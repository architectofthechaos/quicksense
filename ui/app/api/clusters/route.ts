import { auth } from "@/auth";
import { listClusters, createCluster, ApiClientError } from "@/lib/api";

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
  let name = "";
  try {
    const body = await req.json();
    name = (body?.name ?? "").trim();
  } catch {
    return Response.json({ error: { code: "invalid_json", message: "body must be JSON" } }, { status: 400 });
  }
  if (!name) return Response.json({ error: { code: "missing_name", message: "name is required" } }, { status: 400 });
  try {
    const cluster = await createCluster(token, name);
    return Response.json(cluster, { status: 201 });
  } catch (e) {
    return errResponse(e);
  }
}
