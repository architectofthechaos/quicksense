import { describe, it, expect } from "vitest";
import {
  phaseToBadge,
  isTerminalReady,
  connectUrl,
  formatAge,
  resourceSummary,
  normalizeClusterConfig,
  defaultClusterConfig,
  newCell,
  moveCell,
  normalizeContent,
  emptyNotebookContent,
  buildWorkspaceTree,
  notebookDisplayName,
} from "@/lib/types";
import type { NotebookCell, NotebookSummary } from "@/lib/types";

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

// ── Notebooks (Phase 4d) ─────────────────────────────────────────────────────

describe("newCell", () => {
  it("makes a code cell with a unique id and empty source by default", () => {
    const a = newCell("code");
    const b = newCell("code");
    expect(a.type).toBe("code");
    expect(a.source).toBe("");
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id);
  });
  it("makes a markdown cell carrying the given source", () => {
    const c = newCell("markdown", "# Title");
    expect(c.type).toBe("markdown");
    expect(c.source).toBe("# Title");
  });
});

describe("moveCell", () => {
  const cells: NotebookCell[] = [
    { id: "a", type: "code", source: "1" },
    { id: "b", type: "code", source: "2" },
    { id: "c", type: "code", source: "3" },
  ];
  it("moves a cell up", () => {
    const out = moveCell(cells, 1, "up");
    expect(out.map((c) => c.id)).toEqual(["b", "a", "c"]);
  });
  it("moves a cell down", () => {
    const out = moveCell(cells, 1, "down");
    expect(out.map((c) => c.id)).toEqual(["a", "c", "b"]);
  });
  it("clamps at the boundaries (no-op moving the first cell up)", () => {
    expect(moveCell(cells, 0, "up").map((c) => c.id)).toEqual(["a", "b", "c"]);
    expect(moveCell(cells, 2, "down").map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
  it("returns a new array (does not mutate the input)", () => {
    const out = moveCell(cells, 1, "up");
    expect(out).not.toBe(cells);
    expect(cells.map((c) => c.id)).toEqual(["a", "b", "c"]);
  });
});

describe("normalizeContent", () => {
  it("returns a single empty code cell for null/empty/missing content", () => {
    expect(normalizeContent(null).cells).toHaveLength(1);
    expect(normalizeContent(null).cells[0].type).toBe("code");
    expect(normalizeContent({ cells: [] }).cells).toHaveLength(1);
    expect(normalizeContent({} as any).cells).toHaveLength(1);
  });
  it("assigns ids to cells that lack them and preserves source/type", () => {
    const out = normalizeContent({ cells: [{ type: "markdown", source: "hi" } as any, { type: "code", source: "x" } as any] });
    expect(out.cells).toHaveLength(2);
    expect(out.cells[0].id).toBeTruthy();
    expect(out.cells[1].id).toBeTruthy();
    expect(out.cells[0].id).not.toBe(out.cells[1].id);
    expect(out.cells[0]).toMatchObject({ type: "markdown", source: "hi" });
  });
  it("coerces an unknown cell type to code and a missing source to empty string", () => {
    const out = normalizeContent({ cells: [{ type: "weird" as any, source: undefined as any }] });
    expect(out.cells[0].type).toBe("code");
    expect(out.cells[0].source).toBe("");
  });
  it("keeps an existing id stable", () => {
    const out = normalizeContent({ cells: [{ id: "keep", type: "code", source: "1" }] });
    expect(out.cells[0].id).toBe("keep");
  });
});

describe("emptyNotebookContent", () => {
  it("is one empty code cell", () => {
    const c = emptyNotebookContent();
    expect(c.cells).toHaveLength(1);
    expect(c.cells[0].type).toBe("code");
    expect(c.cells[0].source).toBe("");
    expect(c.cells[0].id).toBeTruthy();
  });
});

function summary(id: string, path: string): NotebookSummary {
  return {
    id,
    name: path.split("/").filter(Boolean).pop() ?? path,
    path,
    folder_id: null,
    attached_cluster_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
  };
}

describe("buildWorkspaceTree", () => {
  it("groups notebooks under folders derived from their path", () => {
    const tree = buildWorkspaceTree([
      summary("n1", "/Reports/Q1"),
      summary("n2", "/Reports/Q2"),
      summary("n3", "/scratch"),
    ]);
    // top level: folder "Reports" + notebook "scratch"
    const labels = tree.map((n) => n.label);
    expect(labels).toContain("Reports");
    expect(labels).toContain("scratch");
    const reports = tree.find((n) => n.label === "Reports")!;
    expect(reports.kind).toBe("folder");
    expect(reports.children?.map((c) => c.label).sort()).toEqual(["Q1", "Q2"]);
    expect(reports.children?.every((c) => c.kind === "notebook")).toBe(true);
  });

  it("sorts folders before notebooks, each alphabetically", () => {
    const tree = buildWorkspaceTree([
      summary("n1", "/zeta"),
      summary("n2", "/alpha"),
      summary("n3", "/Folder/x"),
    ]);
    expect(tree.map((n) => n.label)).toEqual(["Folder", "alpha", "zeta"]);
  });

  it("handles a path with no leading slash and a bare name", () => {
    const tree = buildWorkspaceTree([summary("n1", "Loose"), summary("n2", "/Bare")]);
    expect(tree.map((n) => n.label).sort()).toEqual(["Bare", "Loose"]);
    expect(tree.every((n) => n.kind === "notebook")).toBe(true);
  });

  it("attaches the notebook id to leaf nodes", () => {
    const tree = buildWorkspaceTree([summary("n1", "/A/file")]);
    const leaf = tree[0].children![0];
    expect(leaf.notebookId).toBe("n1");
  });

  it("returns an empty array for no notebooks", () => {
    expect(buildWorkspaceTree([])).toEqual([]);
  });
});

describe("notebookDisplayName", () => {
  it("prefers the explicit name", () => {
    expect(notebookDisplayName(summary("n1", "/A/Report"))).toBe("Report");
  });
  it("derives from the path tail when name is blank", () => {
    const s = { ...summary("n1", "/A/Derived"), name: "" };
    expect(notebookDisplayName(s)).toBe("Derived");
  });
  it("falls back to Untitled when both are empty", () => {
    const s = { ...summary("n1", ""), name: "" };
    expect(notebookDisplayName(s)).toBe("Untitled");
  });
});
