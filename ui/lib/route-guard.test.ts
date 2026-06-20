import { describe, it, expect } from "vitest";
import { isProtectedPath } from "@/lib/route-guard";

describe("isProtectedPath", () => {
  it("protects /app and nested routes", () => {
    expect(isProtectedPath("/app")).toBe(true);
    expect(isProtectedPath("/app/clusters")).toBe(true);
    expect(isProtectedPath("/app/catalog")).toBe(true);
  });
  it("does not protect public/auth/static paths", () => {
    expect(isProtectedPath("/")).toBe(false);
    expect(isProtectedPath("/api/auth/signin")).toBe(false);
    expect(isProtectedPath("/applesauce")).toBe(false);
  });
});
