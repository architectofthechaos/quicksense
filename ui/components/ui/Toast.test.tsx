import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ToastProvider, useToast } from "@/components/ui/Toast";

function Probe() {
  const { toast } = useToast();
  return <button onClick={() => toast("Copied sc:// URL")}>fire</button>;
}

describe("Toast", () => {
  it("shows a toast message when triggered", () => {
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>,
    );
    expect(screen.queryByText("Copied sc:// URL")).toBeNull();
    fireEvent.click(screen.getByText("fire"));
    expect(screen.getByText("Copied sc:// URL")).toBeInTheDocument();
  });
});
