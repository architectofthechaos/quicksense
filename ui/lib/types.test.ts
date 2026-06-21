import { describe, it, expect } from "vitest";
import {
  phaseToBadge,
  isTerminalReady,
  connectUrl,
  formatAge,
  resourceSummary,
  normalizeClusterConfig,
  defaultClusterConfig,
} from "@/lib/types";

describe("phaseToBadge", () => {
  it("ready flag wins regardless of phase string", () => {
    expect(phaseToBadge({ phase: "anything", ready: true })).toEqual({ kind: "ready", label: "Ready" });
  });
  it("maps Running phase", () => {
    expect(phaseToBadge({ phase: "Running", ready: false }).kind).toBe("running");
  });
  it("maps Failed/Error phases", () => {
    expect(phaseToBadge({ phase: "Failed", ready: false }).kind).toBe("failed");
    expect(phaseToBadge({ phase: "ErrorState", ready: false }).kind).toBe("failed");
  });
  it("treats empty/Unknown as unknown", () => {
    expect(phaseToBadge({ phase: "", ready: false }).kind).toBe("unknown");
    expect(phaseToBadge({ phase: "Unknown", ready: false }).kind).toBe("unknown");
  });
  it("treats other non-empty phases as pending and shows the raw phase as label", () => {
    const b = phaseToBadge({ phase: "Provisioning", ready: false });
    expect(b.kind).toBe("pending");
    expect(b.label).toBe("Provisioning");
  });
});

describe("isTerminalReady", () => {
  it("is true when ready", () => {
    expect(isTerminalReady({ phase: "", ready: true })).toBe(true);
  });
  it("is true when phase is Running (mirrors api-e2e semantics)", () => {
    expect(isTerminalReady({ phase: "Running", ready: false })).toBe(true);
  });
  it("is false otherwise", () => {
    expect(isTerminalReady({ phase: "Provisioning", ready: false })).toBe(false);
  });
});

describe("connectUrl", () => {
  it("builds the Spark Connect URL from the CR name (operator names the svc <cr>-server:15002)", () => {
    expect(connectUrl("qs-demo-ab12cd34")).toBe("sc://qs-demo-ab12cd34-server:15002");
  });
});

describe("isTerminalReady (desired_state)", () => {
  it("treats a Stopped cluster as terminal even if not ready", () => {
    expect(isTerminalReady({ phase: "", ready: false, desired_state: "Stopped" })).toBe(true);
  });
});

describe("formatAge", () => {
  const now = Date.parse("2026-06-20T12:00:00Z");
  it("returns em dash for missing/invalid input", () => {
    expect(formatAge(undefined, now)).toBe("—");
    expect(formatAge("not-a-date", now)).toBe("—");
  });
  it("formats seconds/minutes/hours/days", () => {
    expect(formatAge("2026-06-20T11:59:30Z", now)).toBe("30s");
    expect(formatAge("2026-06-20T11:45:00Z", now)).toBe("15m");
    expect(formatAge("2026-06-20T09:00:00Z", now)).toBe("3h");
    expect(formatAge("2026-06-18T12:00:00Z", now)).toBe("2d");
  });
});

describe("resourceSummary", () => {
  it("summarizes cpu/mem request→limit", () => {
    expect(
      resourceSummary({ cpu_request: "500m", cpu_limit: "1", memory_request: "1Gi", memory_limit: "2Gi" }),
    ).toBe("500m→1 · 1Gi→2Gi");
  });
  it("handles undefined", () => {
    expect(resourceSummary(undefined)).toBe("—");
  });
});

describe("normalizeClusterConfig", () => {
  it("fills a complete config from a minimal name-only input", () => {
    const c = normalizeClusterConfig({ name: "  prod  " });
    expect(c.name).toBe("prod");
    expect(c.driver).toEqual(defaultClusterConfig().driver);
    expect(c.spark_conf).toEqual({});
    expect(c.worker_min).toBeGreaterThanOrEqual(0);
  });
  it("clamps worker_max to be >= worker_min and trims map keys", () => {
    const c = normalizeClusterConfig({ name: "x", worker_min: 5, worker_max: 2, tags: { "  team  ": "data", "": "skip" } });
    expect(c.worker_min).toBe(5);
    expect(c.worker_max).toBe(5);
    expect(c.tags).toEqual({ team: "data" });
  });
  it("coerces string numerics and stringifies map values", () => {
    const c = normalizeClusterConfig({ name: "x", idle_minutes: "45" as any, env: { A: 1 as any } });
    expect(c.idle_minutes).toBe(45);
    expect(c.env).toEqual({ A: "1" });
  });
});
