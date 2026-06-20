"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { key: "clusters", label: "Clusters", href: "/app/clusters" },
  { key: "catalog", label: "Catalog", href: "/app/catalog" },
] as const;

const FUTURE = ["Jobs", "SQL editor", "Notebooks", "Agents"];

export function NavSidebar() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-surface-border bg-surface">
      {/* Brand */}
      <div className="flex h-14 items-center gap-2.5 border-b border-surface-border px-5">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-md bg-accent font-mono text-sm font-bold text-accent-fg shadow-sm"
          aria-hidden
        >
          Q
        </span>
        <span className="text-[15px] font-semibold tracking-tight text-slate-900">QuickSense</span>
      </div>

      {/* Primary nav */}
      <div className="flex flex-col gap-0.5 p-3">
        {ITEMS.map((it) => {
          const isActive = pathname === it.href || pathname.startsWith(it.href + "/");
          return (
            <Link
              key={it.key}
              href={it.href}
              aria-current={isActive ? "page" : undefined}
              className={`group flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-accent-muted text-teal-800"
                  : "text-slate-600 hover:bg-surface-subtle hover:text-slate-900"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors ${
                  isActive ? "bg-accent" : "bg-slate-300 group-hover:bg-slate-400"
                }`}
                aria-hidden
              />
              {it.label}
            </Link>
          );
        })}
      </div>

      {/* Future sections — visible but inert this sprint */}
      <div className="mt-2 px-3">
        <div className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
          Coming soon
        </div>
        {FUTURE.map((f) => (
          <span
            key={f}
            className="flex cursor-default items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-300"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-slate-200" aria-hidden />
            {f}
          </span>
        ))}
      </div>

      <div className="mt-auto p-4 text-[11px] text-slate-400">Sprint 3 · control plane</div>
    </nav>
  );
}
