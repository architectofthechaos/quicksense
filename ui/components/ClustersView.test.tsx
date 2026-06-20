import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { ClustersView } from "@/components/ClustersView";
import { ToastProvider } from "@/components/ui/Toast";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function renderView() {
  return render(
    <ToastProvider>
      <ClustersView />
    </ToastProvider>,
  );
}

beforeEach(() => vi.restoreAllMocks());

describe("ClustersView", () => {
  it("shows empty state when no clusters", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ clusters: [] }));
    renderView();
    await waitFor(() => expect(screen.getByText(/no clusters/i)).toBeInTheDocument());
  });

  it("renders a clusters table with a phase badge", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        clusters: [{ id: "1", name: "alpha", namespace: "default", cr_name: "qs-alpha-1", phase: "Running", ready: true }],
      }),
    );
    renderView();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });

  it("shows an error banner when the list call fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: { code: "store_error", message: "boom" } }, 500));
    renderView();
    await waitFor(() => expect(screen.getByText(/boom|failed|error/i)).toBeInTheDocument());
  });

  it("creates a cluster via the dialog", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ clusters: [] }))
      .mockResolvedValueOnce(
        jsonResponse({ id: "2", name: "beta", namespace: "default", cr_name: "qs-beta-2", phase: "", ready: false }, 201),
      )
      .mockResolvedValue(
        jsonResponse({
          clusters: [{ id: "2", name: "beta", namespace: "default", cr_name: "qs-beta-2", phase: "Provisioning", ready: false }],
        }),
      );
    renderView();
    await waitFor(() => screen.getByText(/no clusters/i));
    // Header + empty-state both expose a "Create cluster" button; click the first.
    fireEvent.click(screen.getAllByRole("button", { name: /create cluster/i })[0]);
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: "beta" } });
    fireEvent.click(screen.getByRole("button", { name: /^create$/i }));
    await waitFor(() => expect(screen.getByText("beta")).toBeInTheDocument());
    const createCall = spy.mock.calls.find(([, init]) => (init as any)?.method === "POST");
    expect(createCall?.[0]).toBe("/api/clusters");
  });

  it("deletes a cluster", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(
        jsonResponse({
          clusters: [{ id: "7", name: "gamma", namespace: "default", cr_name: "qs-gamma-7", phase: "Ready", ready: true }],
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(jsonResponse({ clusters: [] }));
    renderView();
    await waitFor(() => screen.getByText("gamma"));
    fireEvent.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.getByText(/no clusters/i)).toBeInTheDocument());
    const delCall = spy.mock.calls.find(([, init]) => (init as any)?.method === "DELETE");
    expect(delCall?.[0]).toBe("/api/clusters/7");
  });

  it("opens the detail drawer on row click", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        clusters: [{ id: "1", name: "alpha", namespace: "default", cr_name: "qs-alpha-1", phase: "Ready", ready: true }],
      }),
    );
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByText("alpha"));
    expect(screen.getByRole("dialog", { name: /cluster details/i })).toBeInTheDocument();
    expect(screen.getByText("sc://qs-alpha-1-server:15002")).toBeInTheDocument();
  });

  it("Connect copies the sc:// URL and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(global, "fetch").mockResolvedValue(
      jsonResponse({
        clusters: [{ id: "1", name: "alpha", namespace: "default", cr_name: "qs-alpha-1", phase: "Ready", ready: true }],
      }),
    );
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sc://qs-alpha-1-server:15002"));
    expect(screen.getByText(/connection url copied/i)).toBeInTheDocument();
  });
});
