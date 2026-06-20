import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ThemeToggle } from "@/components/ThemeToggle";

beforeEach(() => {
  document.documentElement.classList.remove("dark");
  localStorage.removeItem("theme");
});

describe("ThemeToggle", () => {
  it("toggles the dark class and persists the choice", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("menuitem");
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
    fireEvent.click(btn);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
