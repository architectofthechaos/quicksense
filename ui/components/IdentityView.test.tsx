import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { IdentityView } from "@/components/IdentityView";
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
      "GET /api/admin/users": () => json({ users: [] }),
      "GET /api/admin/groups": () => json({ groups: [] }),
    };
    const fn = handlers[key] ?? defaults[key];
    return Promise.resolve(fn ? fn(url, init) : json({ error: { code: "not_found", message: "no" } }, 404));
  };
}

function renderView() {
  return render(
    <ToastProvider>
      <IdentityView />
    </ToastProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("IdentityView — load states", () => {
  it("shows a loading state, then empty states for users and groups", async () => {
    vi.spyOn(global, "fetch").mockImplementation(router() as any);
    renderView();
    expect(screen.getAllByText(/loading/i).length).toBeGreaterThan(0);
    await waitFor(() => expect(screen.getByText(/no users yet/i)).toBeInTheDocument());
    expect(screen.getByText(/no groups yet/i)).toBeInTheDocument();
  });

  it("lists users (username, email, enabled) and groups", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () =>
          json({
            users: [
              { id: "u1", username: "alice", email: "alice@x", enabled: true },
              { id: "u2", username: "bob", email: "bob@x", enabled: false },
            ],
          }),
        "GET /api/admin/groups": () => json({ groups: [{ id: "g1", name: "data" }] }),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());
    expect(screen.getByText("alice@x")).toBeInTheDocument();
    expect(screen.getByText("bob")).toBeInTheDocument();
    expect(screen.getByText("data")).toBeInTheDocument();
    // enabled/disabled both surface
    expect(screen.getByText(/enabled/i)).toBeInTheDocument();
    expect(screen.getByText(/disabled/i)).toBeInTheDocument();
  });
});

describe("IdentityView — admin-only (403) and unconfigured (501)", () => {
  it("renders a distinct admin-only state on 403", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () => json({ error: { code: "forbidden", message: "admin only" } }, 403),
        "GET /api/admin/groups": () => json({ error: { code: "forbidden", message: "admin only" } }, 403),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/quicksense_admin role/i)).toBeInTheDocument());
    // No create controls in the forbidden state.
    expect(screen.queryByRole("button", { name: /add user/i })).not.toBeInTheDocument();
  });

  it("renders a distinct 'not configured' state on 501", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () => json({ error: { code: "not_implemented", message: "no kc" } }, 501),
        "GET /api/admin/groups": () => json({ error: { code: "not_implemented", message: "no kc" } }, 501),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/keycloak admin (is )?not configured/i)).toBeInTheDocument());
  });
});

describe("IdentityView — generic error", () => {
  it("shows an error state when the users load fails with 500", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () => json({ error: { code: "internal_error", message: "boom" } }, 500),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/boom/i)).toBeInTheDocument());
  });
});

describe("IdentityView — create user", () => {
  it("opens the dialog, POSTs username + email, then refreshes the list", async () => {
    const post = vi.fn<Handler>(() => json({ id: "u9", username: "carol", email: "carol@x", enabled: true }, 201));
    let users: Array<Record<string, unknown>> = [];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () => json({ users }),
        "POST /api/admin/users": ((url: string, init?: RequestInit) => {
          users = [{ id: "u9", username: "carol", email: "carol@x", enabled: true }];
          return post(url, init);
        }) as Handler,
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/no users yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "carol" } });
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: "carol@x" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const init = post.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ username: "carol", email: "carol@x" });
    await waitFor(() => expect(screen.getByText("carol")).toBeInTheDocument());
  });

  it("surfaces a create error (e.g. 409 conflict) without closing the dialog", async () => {
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "POST /api/admin/users": () => json({ error: { code: "conflict", message: "user exists" } }, 409),
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/no users yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add user/i }));
    fireEvent.change(screen.getByLabelText(/username/i), { target: { value: "dup" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(screen.getByText(/user exists/i)).toBeInTheDocument());
    // Dialog stays open (username field still present).
    expect(screen.getByLabelText(/username/i)).toBeInTheDocument();
  });
});

describe("IdentityView — create group", () => {
  it("opens the dialog, POSTs the name, then refreshes the list", async () => {
    const post = vi.fn<Handler>(() => json({ id: "g9", name: "ml" }, 201));
    let groups: Array<Record<string, unknown>> = [];
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/groups": () => json({ groups }),
        "POST /api/admin/groups": ((url: string, init?: RequestInit) => {
          groups = [{ id: "g9", name: "ml" }];
          return post(url, init);
        }) as Handler,
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText(/no groups yet/i)).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /add group/i }));
    fireEvent.change(screen.getByLabelText(/group name/i), { target: { value: "ml" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(post).toHaveBeenCalled());
    const init = post.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ name: "ml" });
    await waitFor(() => expect(screen.getByText("ml")).toBeInTheDocument());
  });
});

describe("IdentityView — assign role", () => {
  it("PUTs the chosen role to the user's roles endpoint", async () => {
    const put = vi.fn<Handler>(() => new Response(null, { status: 204 }));
    vi.spyOn(global, "fetch").mockImplementation(
      router({
        "GET /api/admin/users": () => json({ users: [{ id: "u1", username: "alice", email: "alice@x", enabled: true }] }),
        "PUT /api/admin/users/u1/roles": put,
      }) as any,
    );
    renderView();
    await waitFor(() => expect(screen.getByText("alice")).toBeInTheDocument());

    const table = screen.getByRole("table", { name: /users/i });
    const row = within(table).getByText("alice").closest("tr")!;
    // Choose a role then assign it.
    fireEvent.change(within(row).getByLabelText(/role for alice/i), { target: { value: "quicksense_admin" } });
    fireEvent.click(within(row).getByRole("button", { name: /assign role to alice/i }));

    await waitFor(() => expect(put).toHaveBeenCalled());
    const init = put.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({ role: "quicksense_admin" });
  });
});
