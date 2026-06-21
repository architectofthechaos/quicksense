import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OutputRenderer } from "@/components/OutputRenderer";
import type { RunOutput } from "@/lib/types";

describe("OutputRenderer", () => {
  it("renders nothing visible for an idle cell with no outputs", () => {
    const { container } = render(<OutputRenderer state="idle" outputs={null} />);
    expect(container.textContent).toBe("");
  });

  it("shows a running indicator", () => {
    render(<OutputRenderer state="running" outputs={null} />);
    expect(screen.getByText(/running/i)).toBeInTheDocument();
  });

  it("renders the execution-unavailable (501) state with a clear message", () => {
    render(<OutputRenderer state="unavailable" outputs={null} />);
    expect(screen.getByText(/execution (is )?not yet available/i)).toBeInTheDocument();
  });

  it("renders stdout text", () => {
    const outputs: RunOutput[] = [{ type: "stdout", text: "hello world" }];
    render(<OutputRenderer state="done" outputs={outputs} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders a result table with columns and rows", () => {
    const outputs: RunOutput[] = [{ type: "result", columns: ["id", "name"], rows: [[1, "a"], [2, "b"]] }];
    render(<OutputRenderer state="done" outputs={outputs} />);
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("name")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
    expect(screen.getByText("b")).toBeInTheDocument();
  });

  it("renders an error with ename, evalue and traceback", () => {
    const outputs: RunOutput[] = [
      { type: "error", ename: "ValueError", evalue: "bad input", traceback: ["line 1", "line 2"] },
    ];
    render(<OutputRenderer state="done" outputs={outputs} />);
    expect(screen.getByText(/ValueError/)).toBeInTheDocument();
    expect(screen.getByText(/bad input/)).toBeInTheDocument();
    expect(screen.getByText(/line 1/)).toBeInTheDocument();
  });

  it("renders a generic error message string", () => {
    render(<OutputRenderer state="error" outputs={null} errorMessage="network down" />);
    expect(screen.getByText(/network down/i)).toBeInTheDocument();
  });
});
