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
