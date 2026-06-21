import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { PermissionsEditor } from "@/components/PermissionsEditor";
import { ToastProvider } from "@/components/ui/Toast";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

// Configurable fetch router keyed by "METHOD path" (query stripped). Handlers get
// the raw (url, init) so body-asserting tests read init.body directly.
type Handler = (url: string, init?: RequestInit) => Response;

function router(handlers: Record<string, Handler> = {}) {
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = url.split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    const key = `${method} ${path}`;
    const defaults: Record<string, Handler> = {
      "GET /api/clusters/c1/permissions": () => json({ permissions: [] }),
      "GET /api/notebooks/n1/permissions": () => json({ permissions: [] }),
    };
    const fn = handlers[key] ?? defaults[key];
    return Promise.resolve(fn ? fn(url, init) : json({ error: { code: "not_found", message: "no" } }, 404));
  };
}

function renderEditor(props: Partial<React.ComponentProps<typeof PermissionsEditor>> = {}) {
  return render(
    <ToastProvider>
      <PermissionsEditor kind="clusters" objectId="c1" levels={["attach", "manage"]} {...props} />
    </ToastProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("PermissionsEditor — load states", () => {
  it("shows a loading state, then the empty state when there are no grants", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor();
    expect(screen.getByText(/loading permissions/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText(/no grants yet|no one else has access/i)).toBeInTheDocument());
  });

  it("lists current grants in a table (principal, type, level)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/clusters/c1/permissions": () =>
          json({ permissions: [{ principal_type: "user", principal_id: "alice", level: "manage" }] }),
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    // Scope to the grants table — "user"/"manage" also appear in the add-grant
    // form's selects, so assert on the row, not the document.
    const table = screen.getByRole("table");
    const row = within(table).getByText("alice").closest("tr")!;
    expect(within(row).getByText("user")).toBeInTheDocument();
    expect(within(row).getByText("manage")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /revoke access for alice/i })).toBeInTheDocument();
  });

  it("shows an error state when the load fails", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "GET /api/clusters/c1/permissions": () => json({ error: { code: "forbidden", message: "denied" } }, 403) }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText(/denied/i)).toBeInTheDocument());
  });
});

describe("PermissionsEditor — level options reflect kind", () => {
  it("renders only the provided levels in the select", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderEditor({ levels: ["view", "run", "edit", "manage"], kind: "notebooks", objectId: "n1" });
    await waitFor(() => expect(screen.getByText(/no grants yet|no one else has access/i)).toBeInTheDocument());
    const select = screen.getByLabelText(/permission level/i) as HTMLSelectElement;
    const options = within(select).getAllByRole("option").map((o) => (o as HTMLOptionElement).value);
    expect(options).toEqual(["view", "run", "edit", "manage"]);
  });
});

describe("PermissionsEditor — grant", () => {
  it("PUTs a grant with the chosen principal + level, then refreshes the list", async () => {
    const put = vi.fn<Handler>(() => json({ principal_type: "user", principal_id: "bob", level: "attach" }));
    let listed: Array<Record<string, unknown>> = [];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/clusters/c1/permissions": () => json({ permissions: listed }),
        "PUT /api/clusters/c1/permissions": ((url: string, init?: RequestInit) => {
          listed = [{ principal_type: "user", principal_id: "bob", level: "attach" }];
          return put(url, init);
        }) as Handler,
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText(/no grants yet|no one else has access/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/principal id/i), { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: /grant/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const init = put.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ principal_type: "user", principal_id: "bob", level: "attach" });
    // optimistic refresh re-lists and renders the new grant
    await waitFor(() => expect(screen.getByText("bob")).toBeInTheDocument());
  });

  it("does not submit an empty principal id", async () => {
    const put = vi.fn<Handler>(() => new Response(null, { status: 204 }));
    vi.spyOn(global, "fetch").mockImplementation(
      router({ "PUT /api/clusters/c1/permissions": put }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText(/no grants yet|no one else has access/i)).toBeInTheDocument());
    // Grant button disabled while the id is blank
    expect(screen.getByRole("button", { name: /grant/i })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /grant/i }));
    expect(put).not.toHaveBeenCalled();
  });

  it("surfaces a grant error (e.g. 400 invalid level)", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "PUT /api/clusters/c1/permissions": () => json({ error: { code: "invalid_level", message: "bad level" } }, 400),
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText(/no grants yet|no one else has access/i)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText(/principal id/i), { target: { value: "bob" } });
    fireEvent.click(screen.getByRole("button", { name: /grant/i }));
    await waitFor(() => expect(screen.getByText(/bad level/i)).toBeInTheDocument());
  });
});

describe("PermissionsEditor — revoke", () => {
  it("DELETEs a grant with the principal query, then refreshes", async () => {
    const del = vi.fn<Handler>(() => new Response(null, { status: 204 }));
    let listed: Array<Record<string, unknown>> = [{ principal_type: "group", principal_id: "data", level: "attach" }];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/clusters/c1/permissions": () => json({ permissions: listed }),
        "DELETE /api/clusters/c1/permissions": ((url: string, init?: RequestInit) => {
          listed = [];
          return del(url, init);
        }) as Handler,
      }) as any,
    );
    renderEditor();
    await waitFor(() => expect(screen.getByText("data")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /revoke access for data/i }));
    await waitFor(() => expect(del).toHaveBeenCalled());
    // the DELETE url carries the principal query params
    const calledUrl = del.mock.calls[0][0];
    expect(calledUrl).toContain("principal_type=group");
    expect(calledUrl).toContain("principal_id=data");
    await waitFor(() => expect(screen.queryByText("data")).not.toBeInTheDocument());
  });
});
