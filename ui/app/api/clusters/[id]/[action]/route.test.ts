import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    clusterLifecycle: vi.fn(),
    cloneCluster: vi.fn(),
    clusterEvents: vi.fn(),
    clusterLogs: vi.fn(),
    clusterMetrics: vi.fn(),
  };
});

import { auth } from "@/auth";
import { clusterLifecycle, cloneCluster, clusterEvents, clusterLogs, clusterMetrics, ApiClientError } from "@/lib/api";
import { GET, POST } from "@/app/api/clusters/[id]/[action]/route";

beforeEach(() => vi.clearAllMocks());

function ctx(action: string, id = "1") {
  return { params: Promise.resolve({ id, action }) } as any;
}
function req(method: string, body?: unknown) {
  return new Request("http://x", { method, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
}

describe("POST /api/clusters/[id]/[action]", () => {
  it("401 unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await POST(req("POST"), ctx("start"));
    expect(res.status).toBe(401);
  });

  it.each(["start", "stop", "restart"] as const)("dispatches the %s lifecycle action", async (action) => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (clusterLifecycle as any).mockResolvedValue({ id: "1", name: "a", namespace: "default", cr_name: "x", phase: "", ready: false });
    const res = await POST(req("POST"), ctx(action));
    expect(res.status).toBe(200);
    expect(clusterLifecycle).toHaveBeenCalledWith("TOK", "1", action);
  });

  it("dispatches clone with a name from the body", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (cloneCluster as any).mockResolvedValue({ id: "2", name: "copy", namespace: "default", cr_name: "y", phase: "", ready: false });
    const res = await POST(req("POST", { name: "copy" }), ctx("clone"));
    expect(res.status).toBe(201);
    expect(cloneCluster).toHaveBeenCalledWith("TOK", "1", "copy");
  });

  it("clone tolerates an empty/absent body", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (cloneCluster as any).mockResolvedValue({ id: "2", name: "x", namespace: "default", cr_name: "y", phase: "", ready: false });
    const res = await POST(req("POST"), ctx("clone"));
    expect(res.status).toBe(201);
    expect(cloneCluster).toHaveBeenCalledWith("TOK", "1", undefined);
  });

  it("404 on an unknown POST action", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await POST(req("POST"), ctx("frobnicate"));
    expect(res.status).toBe(404);
    expect(clusterLifecycle).not.toHaveBeenCalled();
  });

  it("404 when a GET-only action is POSTed", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await POST(req("POST"), ctx("logs"));
    expect(res.status).toBe(404);
  });

  it("propagates an upstream lifecycle error status", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (clusterLifecycle as any).mockRejectedValue(new ApiClientError("busy", 409, "conflict"));
    const res = await POST(req("POST"), ctx("start"));
    expect(res.status).toBe(409);
  });
});

describe("GET /api/clusters/[id]/[action]", () => {
  it("401 unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET(req("GET"), ctx("events"));
    expect(res.status).toBe(401);
  });

  it("returns the events envelope", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (clusterEvents as any).mockResolvedValue([{ type: "Normal", reason: "Pulled", message: "ok", object: "pod/x", count: 1, last_seen: "now" }]);
    const res = await GET(req("GET"), ctx("events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events).toHaveLength(1);
    expect(clusterEvents).toHaveBeenCalledWith("TOK", "1");
  });

  it("returns logs as text/plain", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (clusterLogs as any).mockResolvedValue("driver line\n");
    const res = await GET(req("GET"), ctx("logs"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/plain/);
    expect(await res.text()).toBe("driver line\n");
  });

  it("returns the metrics payload", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (clusterMetrics as any).mockResolvedValue({ available: false });
    const res = await GET(req("GET"), ctx("metrics"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.available).toBe(false);
  });

  it("404 on an unknown GET action", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await GET(req("GET"), ctx("nonsense"));
    expect(res.status).toBe(404);
  });

  it("404 when a POST-only action is GETed", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await GET(req("GET"), ctx("start"));
    expect(res.status).toBe(404);
  });
});
