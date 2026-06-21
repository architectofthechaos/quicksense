import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api")>("@/lib/api");
  return {
    ...actual,
    listCatalogs: vi.fn(),
    listNamespaces: vi.fn(),
    listTables: vi.fn(),
    getTable: vi.fn(),
    getTableSample: vi.fn(),
  };
});

import { auth } from "@/auth";
import { listCatalogs, listNamespaces, listTables, getTable, getTableSample, ApiClientError } from "@/lib/api";
import { GET } from "@/app/api/catalogs/[...path]/route";

beforeEach(() => vi.clearAllMocks());

// Build a route ctx whose params.path is the catch-all segment array.
function ctx(path: string[]) {
  return { params: Promise.resolve({ path }) } as any;
}
function req(url = "http://x/api/catalogs", method = "GET") {
  return new Request(url, { method });
}

describe("GET /api/catalogs/[...path]", () => {
  it("401 when unauthenticated", async () => {
    (auth as any).mockResolvedValue(null);
    const res = await GET(req(), ctx([]));
    expect(res.status).toBe(401);
  });

  it("lists catalogs (empty path)", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (listCatalogs as any).mockResolvedValue([{ name: "quicksense", type: "iceberg-rest" }]);
    const res = await GET(req(), ctx([]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogs).toHaveLength(1);
    expect(listCatalogs).toHaveBeenCalledWith("TOK");
  });

  it("lists namespaces for a catalog", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (listNamespaces as any).mockResolvedValue([{ name: "demo" }]);
    const res = await GET(req(), ctx(["quicksense", "namespaces"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.namespaces).toEqual([{ name: "demo" }]);
    expect(listNamespaces).toHaveBeenCalledWith("TOK", "quicksense");
  });

  it("lists tables for a namespace", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (listTables as any).mockResolvedValue([{ name: "events", namespace: "demo" }]);
    const res = await GET(req(), ctx(["quicksense", "namespaces", "demo", "tables"]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tables).toEqual([{ name: "events", namespace: "demo" }]);
    expect(listTables).toHaveBeenCalledWith("TOK", "quicksense", "demo");
  });

  it("returns table detail", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const detail = {
      location: "s3://b/demo/events",
      format: "iceberg/parquet",
      current_snapshot_id: "1",
      columns: [],
      partition_fields: [],
      properties: {},
      snapshots: [],
    };
    (getTable as any).mockResolvedValue(detail);
    const res = await GET(req(), ctx(["quicksense", "namespaces", "demo", "tables", "events"]));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(detail);
    expect(getTable).toHaveBeenCalledWith("TOK", "quicksense", "demo", "events");
  });

  it("returns a table sample, forwarding the limit", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (getTableSample as any).mockResolvedValue({ columns: ["id"], rows: [[1]] });
    const res = await GET(
      req("http://x/api/catalogs/quicksense/namespaces/demo/tables/events/sample?limit=25"),
      ctx(["quicksense", "namespaces", "demo", "tables", "events", "sample"]),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns).toEqual(["id"]);
    expect(getTableSample).toHaveBeenCalledWith("TOK", "quicksense", "demo", "events", 25);
  });

  it("defaults the sample limit to 100 when absent or invalid", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (getTableSample as any).mockResolvedValue({ columns: [], rows: [] });
    await GET(
      req("http://x/api/catalogs/quicksense/namespaces/demo/tables/events/sample"),
      ctx(["quicksense", "namespaces", "demo", "tables", "events", "sample"]),
    );
    expect(getTableSample).toHaveBeenCalledWith("TOK", "quicksense", "demo", "events", 100);
  });

  it("propagates a 501 from getTableSample (Trino unconfigured)", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (getTableSample as any).mockRejectedValue(new ApiClientError("trino off", 501, "not_implemented"));
    const res = await GET(
      req("http://x/api/catalogs/quicksense/namespaces/demo/tables/events/sample?limit=10"),
      ctx(["quicksense", "namespaces", "demo", "tables", "events", "sample"]),
    );
    expect(res.status).toBe(501);
    const body = await res.json();
    expect(body.error.code).toBe("not_implemented");
  });

  it("404 on an unrecognized path shape", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    const res = await GET(req(), ctx(["quicksense", "bogus"]));
    expect(res.status).toBe(404);
    expect(listNamespaces).not.toHaveBeenCalled();
  });

  it("propagates an upstream error status", async () => {
    (auth as any).mockResolvedValue({ access_token: "TOK" });
    (listCatalogs as any).mockRejectedValue(new ApiClientError("polaris down", 502, "upstream_error"));
    const res = await GET(req(), ctx([]));
    expect(res.status).toBe(502);
  });
});
