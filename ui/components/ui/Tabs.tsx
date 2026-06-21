"use client";
import { useId, useRef, useState, type ReactNode } from "react";

export type TabItem = { id: string; label: string; content: ReactNode };

// Accessible tabs (WAI-ARIA tabs pattern): role=tablist/tab/tabpanel, roving
// tabindex, ArrowLeft/Right + Home/End to move focus, the active tab activated
// on focus. Underline indicator in brand indigo.
export function Tabs({
  items,
  initialId,
  className = "",
}: {
  items: TabItem[];
  initialId?: string;
  className?: string;
}) {
  const baseId = useId();
  const [active, setActive] = useState(initialId ?? items[0]?.id);
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  if (items.length === 0) return null;
  const activeId = items.some((t) => t.id === active) ? active : items[0].id;

  function onKeyDown(e: React.KeyboardEvent) {
    const idx = items.findIndex((t) => t.id === activeId);
    let next = -1;
    if (e.key === "ArrowRight") next = (idx + 1) % items.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + items.length) % items.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = items.length - 1;
    if (next >= 0) {
      e.preventDefault();
      const id = items[next].id;
      setActive(id);
      refs.current[id]?.focus();
    }
  }

  return (
    <div className={className}>
      <div role="tablist" aria-orientation="horizontal" className="flex gap-1 border-b border-border" onKeyDown={onKeyDown}>
        {items.map((t) => {
          const selected = t.id === activeId;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[t.id] = el;
              }}
              role="tab"
              type="button"
              id={`${baseId}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${baseId}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              className={`focus-ring -mb-px border-b-2 px-3.5 py-2 text-sm font-medium transition-colors ${
                selected
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${baseId}-panel-${t.id}`}
          aria-labelledby={`${baseId}-tab-${t.id}`}
          hidden={t.id !== activeId}
          tabIndex={0}
          className="focus-ring pt-4"
        >
          {t.id === activeId && t.content}
        </div>
      ))}
    </div>
  );
}
