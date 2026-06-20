import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, listClusters: vi.fn(), createCluster: vi.fn() };
});

import { auth } from "@/auth";
import { listClusters, createCluster, ApiClientError } from "@/lib/api";
import { GET, POST } from "@/app/api/clusters/route";

beforeEach(() => vi.clearAllMocks());

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
  it("400 on missing name", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await POST(new Request("http://x/api/clusters", { method: "POST", body: JSON.stringify({}) }));
    expect(res.status).toBe(400);
  });
  it("creates and returns 201", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (createCluster as any).mockResolvedValue({ id: "2", name: "b", namespace: "default", cr_name: "y", phase: "", ready: false });
    const res = await POST(new Request("http://x/api/clusters", { method: "POST", body: JSON.stringify({ name: "b" }) }));
    expect(res.status).toBe(201);
    expect(createCluster).toHaveBeenCalledWith("TOK", "b");
  });
  it("propagates upstream ApiClientError status", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (createCluster as any).mockRejectedValue(new ApiClientError("bad gw", 502, "provision_error"));
    const res = await POST(new Request("http://x/api/clusters", { method: "POST", body: JSON.stringify({ name: "b" }) }));
    expect(res.status).toBe(502);
  });
});
