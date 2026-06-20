import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signOut: vi.fn(), SessionProvider: ({ children }: any) => children }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AppShell } from "@/components/AppShell";

describe("AppShell", () => {
  it("renders nav, username, logout, and children", () => {
    render(
      <AppShell username="qsuser" active="clusters">
        <div>CONTENT</div>
      </AppShell>,
    );
    expect(screen.getByText("Clusters")).toBeInTheDocument();
    expect(screen.getByText("Catalog")).toBeInTheDocument();
    expect(screen.getByText("qsuser")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log ?out/i })).toBeInTheDocument();
    expect(screen.getByText("CONTENT")).toBeInTheDocument();
  });
});
