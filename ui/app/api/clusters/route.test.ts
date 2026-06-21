import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, listClusters: vi.fn(), createClusterFull: vi.fn() };
});

import { auth } from "@/auth";
import { listClusters, createClusterFull, ApiClientError } from "@/lib/api";
import { GET, POST } from "@/app/api/clusters/route";

beforeEach(() => vi.clearAllMocks());

function postReq(body: unknown) {
  return new Request("http://x/api/clusters", { method: "POST", body: JSON.stringify(body) });
}

describe("GET /api/clusters", () => {
  it("401 when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });
  it("returns clusters for an authed session", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (listClusters as any).mockResolvedValue([
      { id: "1", name: "a", namespace: "default", cr_name: "x", phase: "Running", ready: false },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clusters).toHaveLength(1);
    expect(listClusters).toHaveBeenCalledWith("TOK");
  });
});

describe("POST /api/clusters", () => {
  it("401 when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await POST(postReq({ name: "b" }));
    expect(res.status).toBe(401);
  });
  it("400 on missing name", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await POST(postReq({ worker_min: 1 }));
    expect(res.status).toBe(400);
    expect(createClusterFull).not.toHaveBeenCalled();
  });
  it("forwards the full config body to createClusterFull and returns 201", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (createClusterFull as any).mockResolvedValue({ id: "2", name: "b", namespace: "default", cr_name: "y", phase: "", ready: false });
    const cfg = {
      name: "b",
      worker_min: 1,
      worker_max: 4,
      driver: { cpu_request: "500m", cpu_limit: "1", memory_request: "1Gi", memory_limit: "2Gi" },
      executor: { cpu_request: "1", cpu_limit: "2", memory_request: "2Gi", memory_limit: "4Gi" },
      image: "",
      idle_minutes: 30,
      spark_conf: { a: "1" },
      env: {},
      tags: {},
    };
    const res = await POST(postReq(cfg));
    expect(res.status).toBe(201);
    expect(createClusterFull).toHaveBeenCalledTimes(1);
    const [tok, forwarded] = (createClusterFull as any).mock.calls[0];
    expect(tok).toBe("TOK");
    // The handler normalizes/forwards the full config (name trimmed, body preserved).
    expect(forwarded.name).toBe("b");
    expect(forwarded.worker_min).toBe(1);
    expect(forwarded.driver.cpu_request).toBe("500m");
    expect(forwarded.spark_conf).toEqual({ a: "1" });
  });
  it("still accepts a minimal name-only body (legacy quick create)", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (createClusterFull as any).mockResolvedValue({ id: "3", name: "c", namespace: "default", cr_name: "z", phase: "", ready: false });
    const res = await POST(postReq({ name: "c" }));
    expect(res.status).toBe(201);
    const [, forwarded] = (createClusterFull as any).mock.calls[0];
    expect(forwarded.name).toBe("c");
    // Defaults are filled so the upstream contract is always complete.
    expect(typeof forwarded.worker_min).toBe("number");
    expect(forwarded.driver).toBeDefined();
    expect(forwarded.spark_conf).toEqual({});
  });
  it("propagates upstream ApiClientError status", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (createClusterFull as any).mockRejectedValue(new ApiClientError("bad gw", 502, "provision_error"));
    const res = await POST(postReq({ name: "b" }));
    expect(res.status).toBe(502);
  });
});
