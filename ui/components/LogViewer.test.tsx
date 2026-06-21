import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { LogViewer } from "@/components/LogViewer";

beforeEach(() => vi.restoreAllMocks());
afterEach(() => vi.useRealTimers());

function textResponse(body: string, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/plain" } });
}

describe("LogViewer", () => {
  it("fetches the logs endpoint and renders the text", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(textResponse("2026 INFO starting\n2026 INFO ready\n"));
    render(<LogViewer clusterId="abc" />);
    await waitFor(() => expect(screen.getByTestId("log-output")).toHaveTextContent("INFO ready"));
    expect(spy.mock.calls[0][0]).toBe("/api/clusters/abc/logs");
  });

  it("shows an error when the endpoint fails", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(textResponse("boom", 500));
    render(<LogViewer clusterId="abc" />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/could not load logs/i));
  });

  it("toggles follow and wrap (aria-pressed flips)", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(textResponse("x\n"));
    render(<LogViewer clusterId="abc" />);
    await waitFor(() => expect(screen.getByTestId("log-output")).toHaveTextContent("x"));

    const follow = screen.getByRole("button", { name: /follow/i });
    const wrap = screen.getByRole("button", { name: /wrap/i });
    expect(follow).toHaveAttribute("aria-pressed", "true");
    expect(wrap).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(follow);
    fireEvent.click(wrap);
    expect(follow).toHaveAttribute("aria-pressed", "false");
    expect(wrap).toHaveAttribute("aria-pressed", "false");
  });

  it("re-polls on an interval", async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(textResponse("tick\n"));
    render(<LogViewer clusterId="abc" />);
    // Flush the initial fetch + its scheduled follow-up (state updates from the
    // resolved fetches happen inside act).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
