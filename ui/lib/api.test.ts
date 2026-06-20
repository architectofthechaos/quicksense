import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiFetch, listClusters, createCluster, getCluster, deleteCluster, ApiClientError } from "@/lib/api";

beforeEach(() => {
  process.env.QUICKSENSE_API_BASE_URL = "http://api.test";
  vi.restoreAllMocks();
});

describe("apiFetch", () => {
  it("injects bearer token + base url + json content-type", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
    await apiFetch("/v1/clusters", "TOK");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://api.test/v1/clusters");
    expect((init!.headers as any).Authorization).toBe("Bearer TOK");
    expect((init!.headers as any)["Content-Type"]).toBe("application/json");
  });
});

describe("listClusters", () => {
  it("unwraps the clusters envelope", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ clusters: [{ id: "1", name: "a", namespace: "default", cr_name: "qs-a-1", phase: "Running", ready: false }] }),
        { status: 200 },
      ),
    );
    const out = await listClusters("TOK");
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("1");
  });
  it("throws ApiClientError with status + code on error envelope", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "store_error", message: "boom" } }), { status: 500 }),
    );
    await expect(listClusters("TOK")).rejects.toMatchObject({ status: 500, code: "store_error" });
  });
  it("handles a non-JSON error body (plain Unauthorized)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("Unauthorized\n", { status: 401 }));
    await expect(listClusters("TOK")).rejects.toMatchObject({ status: 401 });
  });
});

describe("createCluster", () => {
  it("POSTs the name and returns the cluster", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "2", name: "b", namespace: "default", cr_name: "qs-b-2", phase: "", ready: false }), { status: 201 }),
    );
    const c = await createCluster("TOK", "b");
    expect(c.id).toBe("2");
    const [, init] = spy.mock.calls[0];
    expect(init!.method).toBe("POST");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "b" });
  });
});

describe("getCluster", () => {
  it("fetches a single cluster by id", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "9", name: "g", namespace: "default", cr_name: "qs-g-9", phase: "Ready", ready: true }), { status: 200 }),
    );
    const c = await getCluster("TOK", "9");
    expect(c.ready).toBe(true);
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/clusters/9");
  });
});

describe("deleteCluster", () => {
  it("treats 204 as success", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await expect(deleteCluster("TOK", "2")).resolves.toBeUndefined();
  });
  it("throws on a non-204 error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found", message: "gone" } }), { status: 404 }),
    );
    await expect(deleteCluster("TOK", "2")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});
