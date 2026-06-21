import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { SchemaTable } from "@/components/SchemaTable";
import { SampleGrid } from "@/components/SampleGrid";
import { SnapshotList } from "@/components/SnapshotList";
import type { TableColumn, TableSnapshot } from "@/lib/types";

describe("SchemaTable", () => {
  const cols: TableColumn[] = [
    { name: "id", type: "long", required: true, doc: "primary key" },
    { name: "name", type: "string", required: false },
  ];

  it("renders one row per column with name/type/nullable/comment", () => {
    render(<SchemaTable columns={cols} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("long")).toBeInTheDocument();
    expect(screen.getByText("primary key")).toBeInTheDocument();
    // required:true → NOT nullable; required:false → nullable
    const idRow = screen.getByText("id").closest("tr")!;
    expect(within(idRow).getByText(/^no$/i)).toBeInTheDocument();
    const nameRow = screen.getByText("name").closest("tr")!;
    expect(within(nameRow).getByText(/^yes$/i)).toBeInTheDocument();
  });

  it("shows an empty state when there are no columns", () => {
    render(<SchemaTable columns={[]} />);
    expect(screen.getByText(/no columns/i)).toBeInTheDocument();
  });
});

describe("SampleGrid", () => {
  it("renders a header per column and a cell per value", () => {
    render(<SampleGrid columns={["id", "name"]} rows={[[1, "alpha"], [2, "beta"]]} />);
    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.getByText("beta")).toBeInTheDocument();
    // 2 data rows
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2
  });

  it("renders NULL for null/undefined cells", () => {
    render(<SampleGrid columns={["a", "b"]} rows={[[null, undefined]]} />);
    expect(screen.getAllByText("NULL")).toHaveLength(2);
  });

  it("shows an empty state when there are no rows", () => {
    render(<SampleGrid columns={["a"]} rows={[]} />);
    expect(screen.getByText(/no rows/i)).toBeInTheDocument();
  });

  it("stringifies object cells as JSON", () => {
    render(<SampleGrid columns={["meta"]} rows={[[{ k: 1 }]]} />);
    expect(screen.getByText('{"k":1}')).toBeInTheDocument();
  });
});

describe("SnapshotList", () => {
  const snaps: TableSnapshot[] = [
    { snapshot_id: "100", timestamp_ms: 1700000000000, operation: "append" },
    { snapshot_id: "200", timestamp_ms: 1700000600000, operation: "overwrite" },
  ];

  it("renders newest snapshot first", () => {
    render(<SnapshotList snapshots={snaps} currentSnapshotId="200" />);
    const rows = screen.getAllByRole("row").slice(1); // drop header
    // newest (200) should be the first data row
    expect(within(rows[0]).getByText("200")).toBeInTheDocument();
    expect(within(rows[1]).getByText("100")).toBeInTheDocument();
  });

  it("marks the current snapshot", () => {
    render(<SnapshotList snapshots={snaps} currentSnapshotId="200" />);
    const currentRow = screen.getByText("200").closest("tr")!;
    expect(within(currentRow).getByText(/current/i)).toBeInTheDocument();
  });

  it("shows an empty state with no snapshots", () => {
    render(<SnapshotList snapshots={[]} currentSnapshotId="" />);
    expect(screen.getByText(/no history/i)).toBeInTheDocument();
  });
});
