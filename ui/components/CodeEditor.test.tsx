import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CodeEditor } from "@/components/CodeEditor";

describe("CodeEditor", () => {
  it("mounts CodeMirror and renders the initial source", () => {
    const { container } = render(<CodeEditor value={"print('hi')"} onChange={() => {}} />);
    // CodeMirror renders a .cm-editor host with the doc text inside .cm-content.
    const editor = container.querySelector(".cm-editor");
    expect(editor).toBeTruthy();
    expect(container.textContent).toContain("print('hi')");
  });

  it("falls back to a styled textarea when forced (air-gapped/no-CM path) and fires onChange", () => {
    const onChange = vi.fn();
    render(<CodeEditor value={"x = 1"} onChange={onChange} forceTextarea ariaLabel="Cell 1 code" />);
    const ta = screen.getByRole("textbox", { name: "Cell 1 code" });
    expect(ta).toHaveValue("x = 1");
    fireEvent.change(ta, { target: { value: "x = 2" } });
    expect(onChange).toHaveBeenCalledWith("x = 2");
  });

  it("does not mount CodeMirror in the textarea fallback", () => {
    const { container } = render(<CodeEditor value="" onChange={() => {}} forceTextarea />);
    expect(container.querySelector(".cm-editor")).toBeNull();
    expect(container.querySelector("textarea")).toBeTruthy();
  });
});
