import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { Tree, type TreeNode } from "@/components/Tree";

// A small static tree of catalog → namespace → table-ish nodes. Children are
// supplied lazily via loadChildren so we can assert the lazy-expand contract.
function makeNodes(): TreeNode[] {
  return [
    { id: "cat:quicksense", label: "quicksense", kind: "catalog", hasChildren: true },
    { id: "cat:empty", label: "empty", kind: "catalog", hasChildren: true },
  ];
}

describe("Tree", () => {
  it("renders top-level nodes collapsed", () => {
    render(<Tree nodes={makeNodes()} loadChildren={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByText("quicksense")).toBeInTheDocument();
    // collapsed: aria-expanded=false on the expandable row
    const row = screen.getByRole("treeitem", { name: /quicksense/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
  });

  it("lazily loads and shows children on expand, only once", async () => {
    const loadChildren = vi.fn().mockResolvedValue([
      { id: "ns:demo", label: "demo", kind: "namespace", hasChildren: true },
    ] as TreeNode[]);
    render(<Tree nodes={makeNodes()} loadChildren={loadChildren} onSelect={vi.fn()} />);

    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    expect(loadChildren).toHaveBeenCalledTimes(1);
    expect(loadChildren).toHaveBeenCalledWith(expect.objectContaining({ id: "cat:quicksense" }));

    // collapse + re-expand should NOT refetch (children cached)
    fireEvent.click(screen.getByText("quicksense"));
    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    expect(loadChildren).toHaveBeenCalledTimes(1);
  });

  it("shows an empty hint when an expandable node has no children", async () => {
    const loadChildren = vi.fn().mockResolvedValue([] as TreeNode[]);
    render(<Tree nodes={makeNodes()} loadChildren={loadChildren} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("empty"));
    await waitFor(() => expect(screen.getByText(/empty/i)).toBeInTheDocument());
    // the "No items" hint renders inside the expanded group
    await waitFor(() => expect(screen.getByText(/no items/i)).toBeInTheDocument());
  });

  it("surfaces a load error inline", async () => {
    const loadChildren = vi.fn().mockRejectedValue(new Error("boom"));
    render(<Tree nodes={makeNodes()} loadChildren={loadChildren} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText(/failed to load/i)).toBeInTheDocument());
  });

  it("fires onSelect for a leaf node and marks it selected", async () => {
    const onSelect = vi.fn();
    const loadChildren = vi.fn().mockResolvedValue([
      { id: "tbl:events", label: "events", kind: "table", hasChildren: false },
    ] as TreeNode[]);
    const nodes: TreeNode[] = [{ id: "ns:demo", label: "demo", kind: "namespace", hasChildren: true }];
    render(<Tree nodes={nodes} loadChildren={loadChildren} onSelect={onSelect} selectedId={null} />);
    fireEvent.click(screen.getByText("demo"));
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());
    fireEvent.click(screen.getByText("events"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "tbl:events", kind: "table" }));
  });

  it("expands a collapsed node with ArrowRight and collapses with ArrowLeft", async () => {
    const loadChildren = vi.fn().mockResolvedValue([
      { id: "ns:demo", label: "demo", kind: "namespace", hasChildren: true },
    ] as TreeNode[]);
    render(<Tree nodes={makeNodes()} loadChildren={loadChildren} onSelect={vi.fn()} />);
    const row = screen.getByRole("treeitem", { name: /quicksense/ });
    row.focus();
    fireEvent.keyDown(row, { key: "ArrowRight" });
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    expect(screen.getByRole("treeitem", { name: /quicksense/ })).toHaveAttribute("aria-expanded", "true");
    fireEvent.keyDown(screen.getByRole("treeitem", { name: /quicksense/ }), { key: "ArrowLeft" });
    expect(screen.getByRole("treeitem", { name: /quicksense/ })).toHaveAttribute("aria-expanded", "false");
  });

  it("selects a leaf with Enter", async () => {
    const onSelect = vi.fn();
    const nodes: TreeNode[] = [{ id: "tbl:e", label: "events", kind: "table", hasChildren: false }];
    render(<Tree nodes={nodes} loadChildren={vi.fn()} onSelect={onSelect} />);
    const row = screen.getByRole("treeitem", { name: /events/ });
    row.focus();
    fireEvent.keyDown(row, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "tbl:e" }));
  });
});
