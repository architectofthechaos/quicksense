import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import type { WorkspaceNode } from "@/lib/types";

const nodes: WorkspaceNode[] = [
  {
    id: "dir:/Reports",
    label: "Reports",
    kind: "folder",
    children: [{ id: "nb:n1", label: "Q1", kind: "notebook", notebookId: "n1" }],
  },
  { id: "nb:n2", label: "scratch", kind: "notebook", notebookId: "n2" },
];

describe("WorkspaceTree", () => {
  it("renders folders (expanded by default) and notebook leaves", () => {
    render(<WorkspaceTree nodes={nodes} selectedId={null} onSelectNotebook={vi.fn()} />);
    expect(screen.getByText("Reports")).toBeInTheDocument();
    expect(screen.getByText("Q1")).toBeInTheDocument();
    expect(screen.getByText("scratch")).toBeInTheDocument();
    expect(screen.getByRole("treeitem", { name: "Reports" })).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses and expands a folder on click", () => {
    render(<WorkspaceTree nodes={nodes} selectedId={null} onSelectNotebook={vi.fn()} />);
    fireEvent.click(screen.getByText("Reports"));
    expect(screen.queryByText("Q1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Reports"));
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  it("fires onSelectNotebook with the notebook id when a leaf is clicked", () => {
    const onSelect = vi.fn();
    render(<WorkspaceTree nodes={nodes} selectedId={null} onSelectNotebook={onSelect} />);
    fireEvent.click(screen.getByText("Q1"));
    expect(onSelect).toHaveBeenCalledWith("n1");
  });

  it("marks the selected notebook leaf", () => {
    render(<WorkspaceTree nodes={nodes} selectedId="n2" onSelectNotebook={vi.fn()} />);
    expect(screen.getByRole("treeitem", { name: "scratch" })).toHaveAttribute("aria-selected", "true");
  });

  it("selects a leaf with Enter", () => {
    const onSelect = vi.fn();
    render(<WorkspaceTree nodes={nodes} selectedId={null} onSelectNotebook={onSelect} />);
    const leaf = screen.getByRole("treeitem", { name: "scratch" });
    leaf.focus();
    fireEvent.keyDown(leaf, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledWith("n2");
  });
});
