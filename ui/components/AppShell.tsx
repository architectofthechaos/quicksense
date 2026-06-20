import type { ReactNode } from "react";
import { NavSidebar } from "@/components/NavSidebar";
import { UserMenu } from "@/components/UserMenu";

export function AppShell({ username, children }: { username: string; children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-surface-subtle">
      <NavSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-end border-b border-surface-border bg-surface/80 px-6 backdrop-blur">
          <UserMenu username={username} />
        </header>
        <main className="flex-1 px-8 py-7">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
