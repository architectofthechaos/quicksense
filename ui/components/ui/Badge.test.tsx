import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/Badge";

describe("Badge", () => {
  it("renders the label text", () => {
    render(<Badge kind="ready">Ready</Badge>);
    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
  it("applies a distinct class per kind", () => {
    const { container: c1 } = render(<Badge kind="ready">R</Badge>);
    const { container: c2 } = render(<Badge kind="failed">F</Badge>);
    expect(c1.firstChild).not.toBeNull();
    expect((c1.firstChild as HTMLElement).className).not.toBe((c2.firstChild as HTMLElement).className);
  });
});
