"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Boxes, Database, Workflow, SquareTerminal, NotebookPen, Bot, Lock, type LucideIcon } from "lucide-react";
import { ConnectionStatus } from "@/components/ConnectionStatus";

type Item = { key: string; label: string; href: string; icon: LucideIcon };

const ITEMS: Item[] = [
  { key: "clusters", label: "Clusters", href: "/app/clusters", icon: Boxes },
  { key: "catalog", label: "Catalog", href: "/app/catalog", icon: Database },
  { key: "notebooks", label: "Notebooks", href: "/app/notebooks", icon: NotebookPen },
];

const FUTURE: { label: string; icon: LucideIcon }[] = [
  { label: "Jobs", icon: Workflow },
  { label: "SQL editor", icon: SquareTerminal },
  { label: "Agents", icon: Bot },
];

export function NavSidebar() {
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex w-60 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex flex-col gap-0.5 p-3">
        {ITEMS.map(({ key, label, href, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={key}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`focus-ring flex items-center gap-2.5 rounded-lg py-2 pr-3 text-sm transition-colors ${
                active
                  ? "border-l-[3px] border-primary bg-primary-tint pl-[9px] font-semibold text-primary"
                  : "border-l-[3px] border-transparent pl-[9px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={active ? 2.25 : 2} />
              {label}
            </Link>
          );
        })}
      </div>

      <div className="mt-1 px-3">
        <div className="px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-faint">
          Coming soon
        </div>
        {FUTURE.map(({ label, icon: Icon }) => (
          <div
            key={label}
            title="Coming soon"
            aria-disabled="true"
            className="flex cursor-not-allowed items-center gap-2.5 rounded-lg py-2 pl-3 pr-3 text-sm font-medium text-faint"
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={2} />
            {label}
            <Lock className="ml-auto h-3.5 w-3.5" />
          </div>
        ))}
      </div>

      <div className="mt-auto border-t border-border p-2">
        <ConnectionStatus />
      </div>
    </nav>
  );
}
