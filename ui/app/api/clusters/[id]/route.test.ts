import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return { ...actual, getCluster: vi.fn(), deleteCluster: vi.fn(), patchCluster: vi.fn() };
});

import { auth } from "@/auth";
import { getCluster, deleteCluster, patchCluster } from "@/lib/api";
import { GET, DELETE, PATCH } from "@/app/api/clusters/[id]/route";

beforeEach(() => vi.clearAllMocks());
const ctx = { params: Promise.resolve({ id: "1" }) };

describe("GET /api/clusters/[id]", () => {
  it("401 unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET(new Request("http://x"), ctx as any);
    expect(res.status).toBe(401);
  });
  it("returns the cluster", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (getCluster as any).mockResolvedValue({ id: "1", name: "a", namespace: "default", cr_name: "x", phase: "Running", ready: true });
    const res = await GET(new Request("http://x"), ctx as any);
    expect(res.status).toBe(200);
    expect(getCluster).toHaveBeenCalledWith("TOK", "1");
  });
});

describe("DELETE /api/clusters/[id]", () => {
  it("401 unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx as any);
    expect(res.status).toBe(401);
  });
  it("204 on success", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (deleteCluster as any).mockResolvedValue(undefined);
    const res = await DELETE(new Request("http://x", { method: "DELETE" }), ctx as any);
    expect(res.status).toBe(204);
    expect(deleteCluster).toHaveBeenCalledWith("TOK", "1");
  });
});

describe("PATCH /api/clusters/[id]", () => {
  function patchReq(body: unknown) {
    return new Request("http://x", { method: "PATCH", body: JSON.stringify(body) });
  }
  it("401 unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await PATCH(patchReq({ pinned: true }), ctx as any);
    expect(res.status).toBe(401);
  });
  it("forwards a pin patch and returns 200", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (patchCluster as any).mockResolvedValue({ id: "1", name: "a", namespace: "default", cr_name: "x", phase: "", ready: false, pinned: true });
    const res = await PATCH(patchReq({ pinned: true }), ctx as any);
    expect(res.status).toBe(200);
    expect(patchCluster).toHaveBeenCalledWith("TOK", "1", { pinned: true });
  });
  it("400 on invalid JSON", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const bad = new Request("http://x", { method: "PATCH", body: "{not json" });
    const res = await PATCH(bad, ctx as any);
    expect(res.status).toBe(400);
  });
});
