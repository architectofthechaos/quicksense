import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourceField } from "@/components/ResourceField";
import { defaultResourceSpec } from "@/lib/types";

describe("ResourceField", () => {
  it("renders the four quantity inputs seeded from the spec", () => {
    render(<ResourceField label="Driver" value={defaultResourceSpec()} onChange={() => {}} />);
    expect(screen.getByDisplayValue("500m")).toBeInTheDocument(); // cpu request
    expect(screen.getByDisplayValue("1")).toBeInTheDocument(); // cpu limit
    expect(screen.getByDisplayValue("1Gi")).toBeInTheDocument(); // mem request
    expect(screen.getByDisplayValue("2Gi")).toBeInTheDocument(); // mem limit
  });

  it("emits a full ResourceSpec when a field changes", () => {
    const onChange = vi.fn();
    render(<ResourceField label="Executor" value={defaultResourceSpec()} onChange={onChange} />);
    fireEvent.change(screen.getByDisplayValue("500m"), { target: { value: "750m" } });
    expect(onChange).toHaveBeenLastCalledWith({
      cpu_request: "750m",
      cpu_limit: "1",
      memory_request: "1Gi",
      memory_limit: "2Gi",
    });
  });
});
