import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next-auth/react", () => ({ signOut: vi.fn(), SessionProvider: ({ children }: any) => children }));
vi.mock("next/navigation", () => ({ usePathname: () => "/app/clusters" }));
// ConnectionStatus polls the API on mount; stub it so the shell test stays
// focused on structure (and avoids async-effect noise).
vi.mock("@/components/ConnectionStatus", () => ({ ConnectionStatus: () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AppShell } from "@/components/AppShell";

describe("AppShell", () => {
  it("renders nav, the user trigger, and children", () => {
    render(
      <AppShell username="qsuser">
        <div>CONTENT</div>
      </AppShell>,
    );
    expect(screen.getByText("Clusters")).toBeInTheDocument();
    expect(screen.getByText("Catalog")).toBeInTheDocument();
    expect(screen.getByText("qsuser")).toBeInTheDocument();
    expect(screen.getByText("CONTENT")).toBeInTheDocument();
  });

  it("reveals Log out via the user menu dropdown", () => {
    render(
      <AppShell username="qsuser">
        <div>CONTENT</div>
      </AppShell>,
    );
    // Logout is hidden until the menu is opened.
    expect(screen.queryByRole("menuitem", { name: /log ?out/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /qsuser/i }));
    expect(screen.getByRole("menuitem", { name: /log ?out/i })).toBeInTheDocument();
  });
});
