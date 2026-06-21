import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { KeyValueEditor } from "@/components/KeyValueEditor";

// Harness: makes the editor controlled and records the latest emitted record.
function Harness({ initial = {}, onChange }: { initial?: Record<string, string>; onChange?: (r: Record<string, string>) => void }) {
  const [val, setVal] = useState<Record<string, string>>(initial);
  return (
    <KeyValueEditor
      label="Spark conf"
      value={val}
      onChange={(r) => {
        setVal(r);
        onChange?.(r);
      }}
    />
  );
}

describe("KeyValueEditor", () => {
  it("renders existing entries as rows", () => {
    render(<Harness initial={{ "spark.executor.cores": "2" }} />);
    expect(screen.getByDisplayValue("spark.executor.cores")).toBeInTheDocument();
    expect(screen.getByDisplayValue("2")).toBeInTheDocument();
  });

  it("adds a row and emits the new pair once both fields are filled", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.change(screen.getByLabelText(/key 1/i), { target: { value: "k" } });
    fireEvent.change(screen.getByLabelText(/value 1/i), { target: { value: "v" } });
    expect(onChange).toHaveBeenLastCalledWith({ k: "v" });
  });

  it("drops blank-key rows from the emitted record", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    // Only a value, no key → not present in the record.
    fireEvent.change(screen.getByLabelText(/value 1/i), { target: { value: "orphan" } });
    expect(onChange).toHaveBeenLastCalledWith({});
  });

  it("removes a row", () => {
    const onChange = vi.fn();
    render(<Harness initial={{ a: "1", b: "2" }} onChange={onChange} />);
    fireEvent.click(screen.getByRole("button", { name: /remove a/i }));
    expect(onChange).toHaveBeenLastCalledWith({ b: "2" });
  });
});
