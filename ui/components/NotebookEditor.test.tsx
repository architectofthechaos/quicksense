import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { NotebookEditor } from "@/components/NotebookEditor";
import { ToastProvider } from "@/components/ui/Toast";
import type { Notebook } from "@/lib/types";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function notebook(over: Partial<Notebook> = {}): Notebook {
  return {
    id: "n1",
    name: "Analysis",
    path: "/Analysis",
    folder_id: null,
    attached_cluster_id: null,
    created_at: "2026-06-20T00:00:00Z",
    updated_at: "2026-06-20T00:00:00Z",
    content: {
      cells: [
        { id: "c1", type: "code", source: "print('hi')" },
        { id: "c2", type: "markdown", source: "# Notes" },
      ],
    },
    ...over,
  };
}

// A configurable fetch router keyed by "METHOD path". Handlers receive the raw
// (url, init) so body-asserting tests can read init.body directly — we never
// build a throwaway Request from `init` (doing so locks the live init the
// component passed and breaks the real call under undici).
type Handler = (url: string, init?: RequestInit) => Response;

function router(handlers: Record<string, Handler> = {}) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path}`;
    const defaults: Record<string, Handler> = {
      "GET /api/notebooks/n1": () => json(notebook()),
      "PUT /api/notebooks/n1": () => json(notebook()),
      "DELETE /api/notebooks/n1": () => new Response(null, { status: 204 }),
      "POST /api/notebooks/n1/run": () => json({ error: { code: "execution_unavailable", message: "broker pending" } }, 501),
      "GET /api/notebooks/n1/revisions": () => json({ revisions: [] }),
      "POST /api/notebooks/n1/revisions": () => json({ id: "r1", message: "cp", author: "qsuser", created_at: "x" }, 201),
      "GET /api/notebooks/n1/permissions": () => json({ permissions: [] }),
      "GET /api/clusters": () => json({ clusters: [] }),
    };
    const fn = handlers[key] ?? defaults[key];
    return Promise.resolve(fn ? fn(url, init) : json({ error: { code: "not_found", message: "no" } }, 404));
  };
}

function renderEditor(props: Partial<React.ComponentProps<typeof NotebookEditor>> = {}) {
  return render(
    <ToastProvider>
      <NotebookEditor notebookId="n1" {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("NotebookEditor — load & render", () => {
  it("loads the notebook and renders its cells", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    const { container } = renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    // Two cells: one code editor group + one markdown cell.
    expect(screen.getByRole("group", { name: /code cell 1/i })).toBeInTheDocument();
    // CodeMirror tokenizes the source across spans, so assert on aggregate text.
    expect(container.textContent).toContain("print('hi')");
    // markdown cell renders (default to rendered mode since non-empty) → heading
    expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument();
  });

  it("shows an error state with retry when the load fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "GET /api/notebooks/n1": () => json({ error: { code: "not_found", message: "gone" } }, 404) }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText(/couldn’t open this notebook/i)).toBeInTheDocument());
    expect(screen.getByText(/gone/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});

describe("NotebookEditor — cell editing", () => {
  it("adds a code cell below via the insert affordance", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    const before = screen.getAllByRole("group", { name: /code cell/i }).length;
    // The first cell's "Code" insert button
    fireEvent.click(screen.getAllByRole("button", { name: "Code" })[0]);
    await waitFor(() =>
      expect(screen.getAllByRole("group", { name: /code cell/i }).length).toBe(before + 1),
    );
  });

  it("deletes a cell", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    // Two cells initially (one code group), then delete cell 1 → none remain.
    expect(screen.getByRole("group", { name: /code cell 1/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete cell 1/i }));
    await waitFor(() => expect(screen.queryByRole("group", { name: /code cell/i })).not.toBeInTheDocument());
  });

  it("reorders cells: moving cell 2 up puts markdown above code", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    // Initially the markdown cell is cell 2 (rendered mode → "Edit markdown cell 2").
    expect(screen.getByRole("button", { name: /edit markdown cell 2/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /move cell 2 up/i }));
    // After the move, the markdown cell is cell 1 — its toggle relabels accordingly.
    await waitFor(() => expect(screen.getByRole("button", { name: /edit markdown cell 1/i })).toBeInTheDocument());
  });

  it("toggles a markdown cell between rendered and edit", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Notes" })).toBeInTheDocument());
    // The header toggle for the markdown cell (rendered mode → "Edit markdown cell 2").
    fireEvent.click(screen.getByRole("button", { name: /^edit markdown cell 2$/i }));
    expect(screen.getByRole("textbox", { name: /markdown cell 2/i })).toBeInTheDocument();
  });

  it("converts a code cell to markdown", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /convert to markdown/i }));
    // Now there are two markdown-type cells; the converted cell exposes an edit/preview toggle
    await waitFor(() => expect(screen.getAllByRole("button", { name: /markdown cell 1/i }).length).toBeGreaterThan(0));
  });
});

describe("NotebookEditor — save", () => {
  it("enables Save only after an edit, then PUTs the content", async () => {
    const put = vi.fn<Handler>(() => json(notebook()));
    vi.spyOn(global, "fetch").mockImplementation(router({ "PUT /api/notebooks/n1": put }) as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());

    const saveBtn = screen.getByRole("button", { name: /^save$/i });
    expect(saveBtn).toBeDisabled();

    // Make an edit (delete a cell) → dirty
    fireEvent.click(screen.getByRole("button", { name: /delete cell 2/i }));
    await waitFor(() => expect(screen.getByRole("button", { name: /^save$/i })).not.toBeDisabled());

    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());
    // Body carries {content:{cells:[...]}} — read it from the init the router got.
    const init = put.mock.calls[0][1] as RequestInit;
    const body = JSON.parse((init.body as string) ?? "{}");
    expect(body.content.cells).toBeDefined();
  });
});

describe("NotebookEditor — run (501 graceful state)", () => {
  it("running a code cell shows the execution-unavailable state on 501", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run cell 1/i }));
    await waitFor(() => expect(screen.getByText(/execution is not yet available/i)).toBeInTheDocument());
  });

  it("Run all triggers the run endpoint and shows the 501 state", async () => {
    const run = vi.fn(() => json({ error: { code: "execution_unavailable", message: "broker pending" } }, 501));
    vi.spyOn(global, "fetch").mockImplementation(router({ "POST /api/notebooks/n1/run": run as any }) as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run all/i }));
    await waitFor(() => expect(run).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/execution is not yet available/i)).toBeInTheDocument());
  });

  it("renders a successful run's stdout + table output", async () => {
    const run = vi.fn(() =>
      json({ outputs: [{ type: "stdout", text: "done" }, { type: "result", columns: ["id"], rows: [[42]] }] }),
    );
    vi.spyOn(global, "fetch").mockImplementation(router({ "POST /api/notebooks/n1/run": run as any }) as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /run cell 1/i }));
    await waitFor(() => expect(screen.getByText("done")).toBeInTheDocument());
    expect(screen.getByText("42")).toBeInTheDocument();
  });
});

describe("NotebookEditor — version history", () => {
  it("lists revisions and restores one, reloading the content", async () => {
    const restored = notebook({ content: { cells: [{ id: "r-c1", type: "code", source: "restored = True" }] } });
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/notebooks/n1/revisions": () =>
          json({ revisions: [{ id: "rev1", message: "first", author: "qsuser", created_at: "2026-06-20T00:00:00Z" }] }),
        "POST /api/notebooks/n1/revisions/rev1/restore": () => json(restored),
      }) as any,
    );
    const { container } = renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const drawer = await screen.findByRole("dialog", { name: /version history/i });
    expect(within(drawer).getByText("first")).toBeInTheDocument();

    fireEvent.click(within(drawer).getByRole("button", { name: /restore/i }));
    // Restored content replaces the editor; CodeMirror tokenizes so assert aggregate text.
    await waitFor(() => expect(container.textContent).toContain("restored = True"));
  });

  it("saves a revision snapshot", async () => {
    const snap = vi.fn(() => json({ id: "rN", message: "cp", author: "qsuser", created_at: "x" }, 201));
    vi.spyOn(global, "fetch").mockImplementation(router({ "POST /api/notebooks/n1/revisions": snap as any }) as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /history/i }));
    const drawer = await screen.findByRole("dialog", { name: /version history/i });
    fireEvent.click(within(drawer).getByRole("button", { name: /^save$/i }));
    await waitFor(() => expect(snap).toHaveBeenCalled());
  });
});

describe("NotebookEditor — share", () => {
  it("lists permissions, grants and revokes", async () => {
    const put = vi.fn<Handler>(() => new Response(null, { status: 204 }));
    const del = vi.fn<Handler>(() => new Response(null, { status: 204 }));
    let listed = [{ principal_type: "user", principal_id: "alice", level: "run" }];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/notebooks/n1/permissions": () => json({ permissions: listed }),
        "PUT /api/notebooks/n1/permissions": ((url: string, init?: RequestInit) => {
          listed = [...listed, { principal_type: "user", principal_id: "bob", level: "view" }];
          return put(url, init);
        }) as any,
        "DELETE /api/notebooks/n1/permissions": del as any,
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /share/i }));
    const dialog = await screen.findByRole("dialog", { name: /share notebook/i });
    expect(within(dialog).getByText("alice")).toBeInTheDocument();

    fireEvent.change(within(dialog).getByLabelText(/principal id/i), { target: { value: "bob" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /grant/i }));
    await waitFor(() => expect(put).toHaveBeenCalled());

    fireEvent.click(within(dialog).getByRole("button", { name: /revoke access for alice/i }));
    await waitFor(() => expect(del).toHaveBeenCalled());
  });
});

describe("NotebookEditor — attach", () => {
  it("lists clusters and attaches a running one", async () => {
    const attach = vi.fn(() => json(notebook({ attached_cluster_id: "cl1" })));
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/clusters": () =>
          json({ clusters: [{ id: "cl1", name: "prod", namespace: "default", cr_name: "x", phase: "Running", ready: true }] }),
        "POST /api/notebooks/n1/attach": attach as any,
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /attach cluster/i }));
    const dialog = await screen.findByRole("dialog", { name: /attach to a cluster/i });
    expect(within(dialog).getByText("prod")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /^attach$/i }));
    await waitFor(() => expect(attach).toHaveBeenCalled());
  });

  it("disables attach for a non-running cluster", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/clusters": () =>
          json({ clusters: [{ id: "cl2", name: "stopped", namespace: "default", cr_name: "y", phase: "Stopped", ready: false }] }),
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /attach cluster/i }));
    const dialog = await screen.findByRole("dialog", { name: /attach to a cluster/i });
    expect(within(dialog).getByRole("button", { name: /not running/i })).toBeDisabled();
  });
});

describe("NotebookEditor — export", () => {
  it("exposes .ipynb and .py export links pointing at the BFF export route", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    const ipynb = screen.getByRole("menuitem", { name: /ipynb/i }) as HTMLAnchorElement;
    const py = screen.getByRole("menuitem", { name: /python \(\.py\)/i }) as HTMLAnchorElement;
    expect(ipynb.getAttribute("href")).toBe("/api/notebooks/n1/export?format=ipynb");
    expect(py.getAttribute("href")).toBe("/api/notebooks/n1/export?format=py");
  });
});

describe("NotebookEditor — trash", () => {
  it("trashes the notebook and notifies the parent", async () => {
    const onTrashed = vi.fn();
    const del = vi.fn(() => new Response(null, { status: 204 }));
    vi.spyOn(global, "fetch").mockImplementation(router({ "DELETE /api/notebooks/n1": del as any }) as any);
    renderEditor({ onTrashed });
    await waitFor(() => expect(screen.getByRole("heading", { name: /Analysis/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /move to trash/i }));
    await waitFor(() => expect(del).toHaveBeenCalled());
    await waitFor(() => expect(onTrashed).toHaveBeenCalledWith("n1"));
  });
});
