import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  apiFetch,
  listClusters,
  createCluster,
  createClusterFull,
  patchCluster,
  clusterLifecycle,
  cloneCluster,
  clusterEvents,
  clusterLogs,
  clusterMetrics,
  getCluster,
  deleteCluster,
  listCatalogs,
  listNamespaces,
  listTables,
  getTable,
  getTableSample,
  ApiClientError,
} from "@/lib/api";
import type { ClusterConfig } from "@/lib/types";

function sampleConfig(): ClusterConfig {
  return {
    name: "prod",
    worker_min: 1,
    worker_max: 4,
    driver: { cpu_request: "500m", cpu_limit: "1", memory_request: "1Gi", memory_limit: "2Gi" },
    executor: { cpu_request: "1", cpu_limit: "2", memory_request: "2Gi", memory_limit: "4Gi" },
    image: "",
    idle_minutes: 30,
    spark_conf: { "spark.sql.shuffle.partitions": "8" },
    env: { LOG_LEVEL: "INFO" },
    tags: { team: "data" },
  };
}

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

describe("createClusterFull", () => {
  it("POSTs the full config body and returns the cluster", async () => {
    const cfg = sampleConfig();
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "10", name: "prod", namespace: "default", cr_name: "qs-prod-10", phase: "", ready: false }), {
        status: 201,
      }),
    );
    const c = await createClusterFull("TOK", cfg);
    expect(c.id).toBe("10");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://api.test/v1/clusters");
    expect(init!.method).toBe("POST");
    // Whole config is forwarded verbatim, including nested resources + maps.
    expect(JSON.parse(init!.body as string)).toEqual(cfg);
  });
  it("propagates an error envelope", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "invalid", message: "bad" } }), { status: 422 }),
    );
    await expect(createClusterFull("TOK", sampleConfig())).rejects.toMatchObject({ status: 422, code: "invalid" });
  });
});

describe("patchCluster", () => {
  it("PATCHes a pin flag", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", name: "a", namespace: "default", cr_name: "x", phase: "", ready: false, pinned: true }), {
        status: 200,
      }),
    );
    const c = await patchCluster("TOK", "1", { pinned: true });
    expect(c.pinned).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://api.test/v1/clusters/1");
    expect(init!.method).toBe("PATCH");
    expect(JSON.parse(init!.body as string)).toEqual({ pinned: true });
  });
});

describe("clusterLifecycle", () => {
  it.each(["start", "stop", "restart"] as const)("POSTs the %s action", async (action) => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "1", name: "a", namespace: "default", cr_name: "x", phase: "", ready: false }), {
        status: 200,
      }),
    );
    await clusterLifecycle("TOK", "1", action);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`http://api.test/v1/clusters/1/${action}`);
    expect(init!.method).toBe("POST");
  });
  it("throws on an upstream error", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "conflict", message: "busy" } }), { status: 409 }),
    );
    await expect(clusterLifecycle("TOK", "1", "start")).rejects.toMatchObject({ status: 409 });
  });
});

describe("cloneCluster", () => {
  it("POSTs to /clone with an optional name", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "2", name: "copy", namespace: "default", cr_name: "y", phase: "", ready: false }), {
        status: 201,
      }),
    );
    const c = await cloneCluster("TOK", "1", "copy");
    expect(c.id).toBe("2");
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe("http://api.test/v1/clusters/1/clone");
    expect(JSON.parse(init!.body as string)).toEqual({ name: "copy" });
  });
  it("omits the name when not supplied (empty body object)", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "2", name: "x", namespace: "default", cr_name: "y", phase: "", ready: false }), {
        status: 201,
      }),
    );
    await cloneCluster("TOK", "1");
    const [, init] = spy.mock.calls[0];
    expect(JSON.parse(init!.body as string)).toEqual({});
  });
});

describe("clusterEvents", () => {
  it("unwraps the events envelope", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          events: [{ type: "Normal", reason: "Scheduled", message: "ok", object: "pod/x", count: 1, last_seen: "now" }],
        }),
        { status: 200 },
      ),
    );
    const out = await clusterEvents("TOK", "1");
    expect(out).toHaveLength(1);
    expect(out[0].reason).toBe("Scheduled");
  });
  it("tolerates a missing events array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(clusterEvents("TOK", "1")).resolves.toEqual([]);
  });
});

describe("clusterLogs", () => {
  it("returns the raw text body", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValue(new Response("line one\nline two\n", { status: 200, headers: { "Content-Type": "text/plain" } }));
    const text = await clusterLogs("TOK", "1");
    expect(text).toBe("line one\nline two\n");
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/clusters/1/logs");
  });
  it("throws ApiClientError on a non-ok response", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    await expect(clusterLogs("TOK", "1")).rejects.toBeInstanceOf(ApiClientError);
  });
});

describe("clusterMetrics", () => {
  it("returns the metrics-available payload with pods", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ available: true, pods: [{ name: "driver", cpu: "120m", memory: "300Mi" }] }), { status: 200 }),
    );
    const m = await clusterMetrics("TOK", "1");
    expect(m.available).toBe(true);
    expect(m.pods).toHaveLength(1);
  });
  it("returns available:false when metrics-server is absent", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ available: false }), { status: 200 }));
    const m = await clusterMetrics("TOK", "1");
    expect(m.available).toBe(false);
    expect(m.pods).toBeUndefined();
  });
});

// ── Catalog (Phase 4c) ───────────────────────────────────────────────────────

describe("listCatalogs", () => {
  it("unwraps the catalogs envelope", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ catalogs: [{ name: "quicksense", type: "iceberg-rest" }] }), { status: 200 }),
    );
    const out = await listCatalogs("TOK");
    expect(out).toEqual([{ name: "quicksense", type: "iceberg-rest" }]);
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/catalogs");
  });
  it("tolerates a missing catalogs array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(listCatalogs("TOK")).resolves.toEqual([]);
  });
  it("throws ApiClientError on an error envelope", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "upstream_error", message: "polaris down" } }), { status: 502 }),
    );
    await expect(listCatalogs("TOK")).rejects.toMatchObject({ status: 502, code: "upstream_error" });
  });
});

describe("listNamespaces", () => {
  it("unwraps the namespaces envelope and encodes the catalog", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ namespaces: [{ name: "demo" }, { name: "analytics.sales" }] }), { status: 200 }),
    );
    const out = await listNamespaces("TOK", "quick sense");
    expect(out).toHaveLength(2);
    expect(out[1].name).toBe("analytics.sales");
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/catalogs/quick%20sense/namespaces");
  });
  it("tolerates a missing namespaces array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(listNamespaces("TOK", "quicksense")).resolves.toEqual([]);
  });
});

describe("listTables", () => {
  it("unwraps the tables envelope and encodes catalog + namespace", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tables: [{ name: "events", namespace: "demo" }] }), { status: 200 }),
    );
    const out = await listTables("TOK", "quicksense", "demo");
    expect(out).toEqual([{ name: "events", namespace: "demo" }]);
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/catalogs/quicksense/namespaces/demo/tables");
  });
  it("tolerates a missing tables array", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    await expect(listTables("TOK", "quicksense", "demo")).resolves.toEqual([]);
  });
});

describe("getTable", () => {
  it("returns the table-detail payload", async () => {
    const detail = {
      location: "s3://bucket/demo/events",
      format: "iceberg/parquet",
      current_snapshot_id: "123",
      columns: [{ name: "id", type: "long", required: true, doc: "primary key" }],
      partition_fields: ["day"],
      properties: { "write.format.default": "parquet" },
      snapshots: [{ snapshot_id: "123", timestamp_ms: 1700000000000, operation: "append" }],
    };
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify(detail), { status: 200 }));
    const out = await getTable("TOK", "quicksense", "demo", "events");
    expect(out).toEqual(detail);
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/catalogs/quicksense/namespaces/demo/tables/events");
  });
  it("propagates a 404 for an unknown table", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_found", message: "no such table" } }), { status: 404 }),
    );
    await expect(getTable("TOK", "quicksense", "demo", "missing")).rejects.toMatchObject({ status: 404, code: "not_found" });
  });
});

describe("getTableSample", () => {
  it("returns columns + rows and appends the limit query", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ columns: ["id", "name"], rows: [[1, "a"], [2, "b"]] }), { status: 200 }),
    );
    const out = await getTableSample("TOK", "quicksense", "demo", "events", 50);
    expect(out.columns).toEqual(["id", "name"]);
    expect(out.rows).toHaveLength(2);
    expect(spy.mock.calls[0][0]).toBe("http://api.test/v1/catalogs/quicksense/namespaces/demo/tables/events/sample?limit=50");
  });
  it("throws ApiClientError carrying 501 when Trino is unconfigured", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "not_implemented", message: "trino not configured" } }), { status: 501 }),
    );
    await expect(getTableSample("TOK", "quicksense", "demo", "events", 50)).rejects.toMatchObject({
      status: 501,
      code: "not_implemented",
    });
  });
});
