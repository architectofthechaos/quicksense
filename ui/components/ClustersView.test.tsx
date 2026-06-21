import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, within } from "@testing-library/react";
import { ClustersView } from "@/components/ClustersView";
import { ToastProvider } from "@/components/ui/Toast";
import type { Cluster } from "@/lib/types";
import { defaultClusterConfig } from "@/lib/types";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

function makeCluster(over: Partial<Cluster> = {}): Cluster {
  return {
    id: "1",
    name: "alpha",
    namespace: "default",
    cr_name: "qs-alpha-1",
    phase: "Running",
    ready: true,
    pinned: false,
    desired_state: "Running",
    config: defaultClusterConfig("alpha"),
    ...over,
  };
}

function renderView() {
  return render(
    <ToastProvider>
      <ClustersView />
    </ToastProvider>,
  );
}

// Find the most recent fetch call matching a predicate.
function lastCall(spy: any, pred: (url: string, init: any) => boolean) {
  return [...spy.mock.calls].reverse().find(([url, init]: [string, any]) => pred(url, init));
}

beforeEach(() => vi.restoreAllMocks());

describe("ClustersView", () => {
  it("shows empty state when no clusters", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ clusters: [] }));
    renderView();
    await waitFor(() => expect(screen.getByText(/no clusters/i)).toBeInTheDocument());
  });

  it("renders a full-width table with status, workers and resource columns", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ clusters: [makeCluster()] }));
    renderView();
    await waitFor(() => expect(screen.getByText("alpha")).toBeInTheDocument());
    expect(screen.getByText("Ready")).toBeInTheDocument();
    // worker range 1–2 from the default config
    expect(screen.getByText("1–2")).toBeInTheDocument();
    expect(screen.getByText("Workers")).toBeInTheDocument();
    expect(screen.getByText("Driver")).toBeInTheDocument();
    expect(screen.getByText("Executor")).toBeInTheDocument();
  });

  it("shows an error banner when the list call fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ error: { code: "store_error", message: "boom" } }, 500));
    renderView();
    await waitFor(() => expect(screen.getByText(/boom|failed|error/i)).toBeInTheDocument());
  });

  it("serializes the full create payload (resources + advanced maps)", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ clusters: [] }))
      .mockResolvedValueOnce(jsonResponse(makeCluster({ id: "2", name: "beta" }), 201))
      .mockResolvedValue(jsonResponse({ clusters: [makeCluster({ id: "2", name: "beta", ready: false, phase: "Provisioning" })] }));
    renderView();
    await waitFor(() => screen.getByText(/no clusters/i));

    fireEvent.click(screen.getAllByRole("button", { name: /create cluster/i })[0]);
    const dialog = screen.getByRole("dialog", { name: /create production cluster/i });
    fireEvent.change(within(dialog).getByPlaceholderText("my-cluster"), { target: { value: "beta" } });
    fireEvent.change(within(dialog).getByLabelText(/min workers/i), { target: { value: "2" } });
    fireEvent.change(within(dialog).getByLabelText(/max workers/i), { target: { value: "6" } });

    // Open Advanced and add a spark conf entry.
    fireEvent.click(within(dialog).getByRole("button", { name: /advanced/i }));
    fireEvent.click(within(dialog).getByRole("button", { name: /add config/i }));
    fireEvent.change(within(dialog).getByLabelText(/spark configuration key 1/i), {
      target: { value: "spark.executor.cores" },
    });
    fireEvent.change(within(dialog).getByLabelText(/spark configuration value 1/i), { target: { value: "2" } });

    fireEvent.click(within(dialog).getByRole("button", { name: /^create$/i }));

    await waitFor(() => {
      const post = lastCall(spy, (url, init) => url === "/api/clusters" && init?.method === "POST");
      expect(post).toBeTruthy();
    });
    const post = lastCall(spy, (url, init) => url === "/api/clusters" && init?.method === "POST");
    const payload = JSON.parse(post![1].body as string);
    expect(payload.name).toBe("beta");
    expect(payload.worker_min).toBe(2);
    expect(payload.worker_max).toBe(6);
    expect(payload.driver).toMatchObject({ cpu_request: expect.any(String), memory_limit: expect.any(String) });
    expect(payload.executor).toBeDefined();
    expect(payload.spark_conf).toEqual({ "spark.executor.cores": "2" });
  });

  it("invokes lifecycle Stop from the row menu", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ clusters: [makeCluster({ desired_state: "Running" })] }))
      .mockResolvedValueOnce(jsonResponse(makeCluster({ desired_state: "Stopped", ready: false, phase: "" })))
      .mockResolvedValue(jsonResponse({ clusters: [makeCluster({ desired_state: "Stopped", ready: false, phase: "" })] }));
    renderView();
    await waitFor(() => screen.getByText("alpha"));

    fireEvent.click(screen.getByRole("button", { name: /actions for alpha/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^stop$/i }));

    await waitFor(() => {
      const call = lastCall(spy, (url, init) => url === "/api/clusters/1/stop" && init?.method === "POST");
      expect(call).toBeTruthy();
    });
  });

  it("gates Start when running and Stop when stopped", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ clusters: [makeCluster({ desired_state: "Running" })] }));
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByRole("button", { name: /actions for alpha/i }));
    // Running cluster: Start disabled, Stop enabled.
    expect(screen.getByRole("menuitem", { name: /^start$/i })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: /^stop$/i })).not.toBeDisabled();
  });

  it("toggles pin via PATCH", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ clusters: [makeCluster({ pinned: false })] }))
      .mockResolvedValueOnce(jsonResponse(makeCluster({ pinned: true })))
      .mockResolvedValue(jsonResponse({ clusters: [makeCluster({ pinned: true })] }));
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByRole("button", { name: /actions for alpha/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^pin$/i }));
    await waitFor(() => {
      const call = lastCall(spy, (url, init) => url === "/api/clusters/1" && init?.method === "PATCH");
      expect(call).toBeTruthy();
    });
    const call = lastCall(spy, (url, init) => url === "/api/clusters/1" && init?.method === "PATCH");
    expect(JSON.parse(call![1].body as string)).toEqual({ pinned: true });
  });

  it("deletes a cluster from the row menu", async () => {
    const spy = vi
      .spyOn(global, "fetch")
      .mockResolvedValueOnce(jsonResponse({ clusters: [makeCluster({ id: "7", name: "gamma" })] }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValue(jsonResponse({ clusters: [] }));
    renderView();
    await waitFor(() => screen.getByText("gamma"));
    fireEvent.click(screen.getByRole("button", { name: /actions for gamma/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /^delete$/i }));
    await waitFor(() => expect(screen.getByText(/no clusters/i)).toBeInTheDocument());
    const del = lastCall(spy, (url, init) => url === "/api/clusters/7" && init?.method === "DELETE");
    expect(del).toBeTruthy();
  });

  it("opens the detail drawer with tabs and shows the connect string", async () => {
    // List call + the Events/Metrics tab fetches the detail mounts.
    vi.spyOn(global, "fetch").mockImplementation((input: any) => {
      const url = String(input);
      if (url.endsWith("/events")) return Promise.resolve(jsonResponse({ events: [] }));
      if (url.endsWith("/metrics")) return Promise.resolve(jsonResponse({ available: false }));
      if (url.endsWith("/logs")) return Promise.resolve(textResponse(""));
      return Promise.resolve(jsonResponse({ clusters: [makeCluster()] }));
    });
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByText("alpha"));
    const drawer = screen.getByRole("dialog", { name: /cluster details/i });
    expect(within(drawer).getByRole("tab", { name: /overview/i })).toBeInTheDocument();
    expect(within(drawer).getByRole("tab", { name: /driver logs/i })).toBeInTheDocument();
    expect(within(drawer).getByText("sc://qs-alpha-1-server:15002")).toBeInTheDocument();
  });

  it("renders the Metrics empty state when metrics-server is unavailable", async () => {
    vi.spyOn(global, "fetch").mockImplementation((input: any) => {
      const url = String(input);
      if (url.endsWith("/events")) return Promise.resolve(jsonResponse({ events: [] }));
      if (url.endsWith("/metrics")) return Promise.resolve(jsonResponse({ available: false }));
      if (url.endsWith("/logs")) return Promise.resolve(textResponse(""));
      return Promise.resolve(jsonResponse({ clusters: [makeCluster()] }));
    });
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByText("alpha"));
    const drawer = screen.getByRole("dialog", { name: /cluster details/i });
    fireEvent.click(within(drawer).getByRole("tab", { name: /metrics/i }));
    await waitFor(() => expect(within(drawer).getByText(/metrics unavailable/i)).toBeInTheDocument());
  });

  it("Connect copies the sc:// URL and toasts", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    vi.spyOn(global, "fetch").mockResolvedValue(jsonResponse({ clusters: [makeCluster()] }));
    renderView();
    await waitFor(() => screen.getByText("alpha"));
    fireEvent.click(screen.getByRole("button", { name: /connect/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("sc://qs-alpha-1-server:15002"));
    expect(screen.getByText(/connection url copied/i)).toBeInTheDocument();
  });
});
