import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tabs } from "@/components/ui/Tabs";

const items = [
  { id: "overview", label: "Overview", content: <div>OVERVIEW BODY</div> },
  { id: "events", label: "Events", content: <div>EVENTS BODY</div> },
  { id: "logs", label: "Logs", content: <div>LOGS BODY</div> },
];

describe("Tabs", () => {
  it("renders the first tab's content by default", () => {
    render(<Tabs items={items} />);
    expect(screen.getByText("OVERVIEW BODY")).toBeInTheDocument();
    expect(screen.queryByText("EVENTS BODY")).toBeNull();
  });

  it("honors an initialId", () => {
    render(<Tabs items={items} initialId="logs" />);
    expect(screen.getByText("LOGS BODY")).toBeInTheDocument();
  });

  it("switches content on tab click and sets aria-selected", () => {
    render(<Tabs items={items} />);
    fireEvent.click(screen.getByRole("tab", { name: "Events" }));
    expect(screen.getByText("EVENTS BODY")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "false");
  });

  it("moves between tabs with ArrowRight/ArrowLeft", () => {
    render(<Tabs items={items} />);
    const tablist = screen.getByRole("tablist");
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(screen.getByRole("tab", { name: "Events" })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(screen.getByRole("tab", { name: "Overview" })).toHaveAttribute("aria-selected", "true");
  });

  it("wires tab/tabpanel aria relationships", () => {
    render(<Tabs items={items} />);
    const tab = screen.getByRole("tab", { name: "Overview" });
    const panel = screen.getByRole("tabpanel");
    expect(tab).toHaveAttribute("aria-controls", panel.id);
    expect(panel).toHaveAttribute("aria-labelledby", tab.id);
  });
});
