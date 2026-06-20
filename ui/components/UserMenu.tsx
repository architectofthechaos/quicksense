"use client";
import { signOut } from "next-auth/react";
import { Button } from "@/components/ui/Button";

export function UserMenu({ username }: { username: string }) {
  const initial = (username?.[0] ?? "?").toUpperCase();
  return (
    <div className="flex items-center gap-3">
      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-muted text-xs font-semibold text-teal-800"
          aria-hidden
        >
          {initial}
        </span>
        <span className="text-sm font-medium text-slate-700">{username}</span>
      </div>
      <Button variant="ghost" onClick={() => signOut({ callbackUrl: "/" })}>
        Log out
      </Button>
    </div>
  );
}
