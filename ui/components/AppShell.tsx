import type { ReactNode } from "react";
import { NavSidebar } from "@/components/NavSidebar";
import { UserMenu } from "@/components/UserMenu";
import { Wordmark } from "@/components/brand/Logo";

export function AppShell({ username, children }: { username: string; children: ReactNode }) {
  return (
    <div className="flex h-screen flex-col bg-background">
      <header className="z-30 flex h-14 shrink-0 items-center justify-between border-b border-border bg-surface px-5 shadow-topbar">
        <Wordmark markClassName="h-6 w-6" />
        <UserMenu username={username} />
      </header>
      <div className="flex min-h-0 flex-1">
        <NavSidebar />
        <main className="flex-1 overflow-auto px-8 py-7">
          <div className="mx-auto max-w-5xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
