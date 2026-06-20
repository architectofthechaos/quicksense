import { describe, it, expect, beforeEach } from "vitest";
import { resolveTheme, applyTheme, type Theme } from "@/lib/theme";

describe("resolveTheme", () => {
  it("honors a stored choice over system preference", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
  });
  it("falls back to system preference when nothing stored", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
  });
  it("ignores garbage stored values and uses system preference", () => {
    expect(resolveTheme("purple", true)).toBe("dark");
  });
});

describe("applyTheme", () => {
  beforeEach(() => {
    document.documentElement.classList.remove("dark");
    localStorage.removeItem("theme");
  });
  it("adds the dark class + persists for dark", () => {
    applyTheme("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });
  it("removes the dark class + persists for light", () => {
    document.documentElement.classList.add("dark");
    applyTheme("light" as Theme);
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("theme")).toBe("light");
  });
});
