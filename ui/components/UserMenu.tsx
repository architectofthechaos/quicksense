"use client";
import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { ChevronDown, LogOut } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";

export function UserMenu({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const initial = (username?.[0] ?? "?").toUpperCase();

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemCls =
    "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-muted";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="focus-ring flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 transition-colors hover:bg-muted"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-fg">
          {initial}
        </span>
        <span className="text-sm font-medium text-foreground">{username}</span>
        <ChevronDown className="h-4 w-4 text-muted-foreground" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 animate-fade-in overflow-hidden rounded-xl border border-border bg-surface p-1.5 shadow-pop"
        >
          <div className="px-2.5 py-2">
            <div className="text-xs text-muted-foreground">Signed in as</div>
            <div className="truncate text-sm font-semibold text-foreground">{username}</div>
          </div>
          <div className="my-1 h-px bg-border" />
          <ThemeToggle className={itemCls} />
          <button type="button" role="menuitem" onClick={() => signOut({ callbackUrl: "/" })} className={itemCls}>
            <LogOut className="h-4 w-4" />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
