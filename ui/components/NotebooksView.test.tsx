import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NotebooksView } from "@/components/NotebooksView";
import { ToastProvider } from "@/components/ui/Toast";
import type { NotebookSummary } from "@/lib/types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function summary(id: string, name: string, path: string): NotebookSummary {
  return {
    id,
    name,
    path,
    folder_id: null,
    attached_cluster_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
  };
}

// Router that ignores `init` (never builds a Request from the live init).
type Handler = (url: string, init?: RequestInit) => Response;
function router(handlers: Record<string, Handler> = {}) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path}`;
    const fn = handlers[key];
    if (fn) return Promise.resolve(fn(url, init));
    // Default notebook-detail load for any selected notebook.
    if (method === "GET" && /^\/api\/notebooks\/[^/]+$/.test(path)) {
      const id = path.split("/").pop()!;
      return Promise.resolve(
        json({ ...summary(id, "Opened", "/Opened"), content: { cells: [{ id: "c1", type: "code", source: "x=1" }] } }),
      );
    }
    if (path.endsWith("/revisions")) return Promise.resolve(json({ revisions: [] }));
    if (path.endsWith("/permissions")) return Promise.resolve(json({ permissions: [] }));
    if (path === "/api/clusters") return Promise.resolve(json({ clusters: [] }));
    return Promise.resolve(json({ error: { code: "nf", message: "no" } }, 404));
  };
}

function renderView() {
  return render(
    <ToastProvider>
      <NotebooksView />
    </ToastProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("NotebooksView", () => {
  it("loads notebooks and renders them grouped by folder in the workspace", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/notebooks": () =>
          json({ notebooks: [summary("n1", "Q1", "/Reports/Q1"), summary("n2", "scratch", "/scratch")] }),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText("Reports")).toBeInTheDocument());
    expect(screen.getByText("scratch")).toBeInTheDocument();
    // Folder expanded by default → the notebook leaf is visible
    expect(screen.getByText("Q1")).toBeInTheDocument();
  });

  it("shows the workspace empty state when there are no notebooks", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router({ "GET /api/notebooks": () => json({ notebooks: [] }) }) as any);
    renderView();
    await waitFor(() => expect(screen.getByText(/no notebooks yet/i)).toBeInTheDocument());
    // The right pane invites creation
    expect(screen.getByText(/create a notebook/i)).toBeInTheDocument();
  });

  it("shows an error banner when the list fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "GET /api/notebooks": () => json({ error: { code: "store_error", message: "db down" } }, 500) }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/db down/i)).toBeInTheDocument());
  });

  it("opens a notebook when its leaf is clicked", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "GET /api/notebooks": () => json({ notebooks: [summary("n1", "Analysis", "/Analysis")] }) }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText("Analysis")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Analysis"));
    // Editor loads the selected notebook → its toolbar heading appears.
    await waitFor(() => expect(screen.getByRole("heading", { name: /Opened/ })).toBeInTheDocument());
  });

  it("creates a notebook via the dialog and selects it", async () => {
    const create = vi.fn<Handler>(() => json({ ...summary("n9", "Brand new", "/Brand new"), content: { cells: [] } }, 201));
    let list: NotebookSummary[] = [];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/notebooks": () => json({ notebooks: list }),
        "POST /api/notebooks": (url, init) => {
          list = [summary("n9", "Brand new", "/Brand new")];
          return create(url, init);
        },
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/no notebooks yet/i)).toBeInTheDocument());

    // Several "New notebook" affordances exist (header + empty states); any opens the dialog.
    fireEvent.click(screen.getAllByRole("button", { name: /new notebook/i })[0]);
    const dialog = await screen.findByRole("dialog", { name: /new notebook/i });
    fireEvent.change(within(dialog).getByLabelText(/^name$/i), { target: { value: "Brand new" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(create).toHaveBeenCalled());
    // POST body carries the name.
    const init = create.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string).name).toBe("Brand new");
  });

  it("renders a loading skeleton before the list resolves", async () => {
    let resolve: (r: Response) => void = () => {};
    const pending = new Promise<Response>((r) => (resolve = r));
    vi.spyOn(global, "fetch").mockImplementation(((input: any) => {
      if (String(input).endsWith("/api/notebooks")) return pending;
      return Promise.resolve(json({ error: { code: "nf", message: "no" } }, 404));
    }) as any);
    renderView();
    expect(screen.getByLabelText(/loading notebooks/i)).toBeInTheDocument();
    resolve(json({ notebooks: [] }));
    await waitFor(() => expect(screen.getByText(/no notebooks yet/i)).toBeInTheDocument());
  });
});
