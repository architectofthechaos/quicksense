import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { CatalogView } from "@/components/CatalogView";
import type { TableDetail } from "@/lib/types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const detail: TableDetail = {
  location: "s3://bucket/demo/events",
  format: "iceberg/parquet",
  current_snapshot_id: "555",
  columns: [
    { name: "id", type: "long", required: true, doc: "primary key" },
    { name: "ts", type: "timestamp", required: false },
  ],
  partition_fields: ["day"],
  properties: { "write.format.default": "parquet" },
  snapshots: [{ snapshot_id: "555", timestamp_ms: 1700000000000, operation: "append" }],
};

// Route fetch by URL so the component's lazy-load sequence is exercised
// realistically (catalogs → namespaces → tables → detail/sample).
function router(over: Partial<Record<string, () => Response>> = {}) {
  return (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.split("?")[0];
    const table = {
      "/api/catalogs": () => json({ catalogs: [{ name: "quicksense", type: "iceberg-rest" }] }),
      "/api/catalogs/quicksense/namespaces": () => json({ namespaces: [{ name: "demo" }] }),
      "/api/catalogs/quicksense/namespaces/demo/tables": () => json({ tables: [{ name: "events", namespace: "demo" }] }),
      "/api/catalogs/quicksense/namespaces/demo/tables/events": () => json(detail),
      "/api/catalogs/quicksense/namespaces/demo/tables/events/sample": () =>
        json({ columns: ["id", "ts"], rows: [[1, "2024-01-01"]] }),
      ...over,
    } as Record<string, () => Response>;
    const fn = table[path];
    return Promise.resolve(fn ? fn() : json({ error: { code: "not_found", message: "no" } }, 404));
  };
}

beforeEach(() => vi.restoreAllMocks());

describe("CatalogView", () => {
  it("loads and renders catalogs in the tree", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());
  });

  it("shows an empty state when there are no catalogs", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "/api/catalogs": () => json({ catalogs: [] }) }) as any,
    );
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText(/no catalogs/i)).toBeInTheDocument());
  });

  it("shows an error banner when the catalog list fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "/api/catalogs": () => json({ error: { code: "upstream_error", message: "polaris down" } }, 502) }) as any,
    );
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText(/polaris down/i)).toBeInTheDocument());
  });

  it("drills catalog → namespace → table and shows the table detail with columns", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());

    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());

    fireEvent.click(screen.getByText("demo"));
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());

    fireEvent.click(screen.getByText("events"));
    // Columns tab is default → schema rows visible
    await waitFor(() => expect(screen.getByText("id")).toBeInTheDocument());
    expect(screen.getByText("timestamp")).toBeInTheDocument();
    // header shows the fully-qualified name somewhere
    expect(screen.getByRole("heading", { name: /events/i })).toBeInTheDocument();
  });

  it("renders the Details tab with location, format and partition fields", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());
    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    fireEvent.click(screen.getByText("demo"));
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());
    fireEvent.click(screen.getByText("events"));
    await waitFor(() => expect(screen.getByText("id")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /details/i }));
    expect(screen.getByText("s3://bucket/demo/events")).toBeInTheDocument();
    expect(screen.getByText("iceberg/parquet")).toBeInTheDocument();
    expect(screen.getByText("day")).toBeInTheDocument();
    expect(screen.getByText("write.format.default")).toBeInTheDocument();
  });

  it("shows a graceful 'sample unavailable' state on a 501 from the sample endpoint", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "/api/catalogs/quicksense/namespaces/demo/tables/events/sample": () =>
          json({ error: { code: "not_implemented", message: "trino not configured" } }, 501),
      }) as any,
    );
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());
    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    fireEvent.click(screen.getByText("demo"));
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());
    fireEvent.click(screen.getByText("events"));
    await waitFor(() => expect(screen.getByText("id")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /sample/i }));
    await waitFor(() => expect(screen.getByText(/sample (data )?unavailable/i)).toBeInTheDocument());
  });

  it("renders the static Permissions placeholder", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());
    fireEvent.click(screen.getByText("quicksense"));
    await waitFor(() => expect(screen.getByText("demo")).toBeInTheDocument());
    fireEvent.click(screen.getByText("demo"));
    await waitFor(() => expect(screen.getByText("events")).toBeInTheDocument());
    fireEvent.click(screen.getByText("events"));
    await waitFor(() => expect(screen.getByText("id")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("tab", { name: /permissions/i }));
    expect(screen.getByText(/phase 4e/i)).toBeInTheDocument();
  });

  it("shows the no-selection prompt before a table is chosen", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    render(<CatalogView />);
    await waitFor(() => expect(screen.getByText("quicksense")).toBeInTheDocument());
    expect(screen.getByText(/select a table/i)).toBeInTheDocument();
  });
});
