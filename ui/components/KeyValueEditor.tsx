"use client";
import { useId, useState, useEffect, useRef } from "react";
import { Plus, Trash2 } from "lucide-react";

// KeyValueEditor edits a Record<string,string> as ordered key/value rows. It
// keeps a local row list (so a user can type a key before it is non-blank, and
// so ordering + blank rows survive) and projects it to a record on every change;
// blank-key rows are dropped from the emitted record but stay visible until
// filled. It re-seeds from `value` only when the parent resets it to something
// other than what we last committed.

type Row = { k: string; v: string };

function recordToRows(rec: Record<string, string>): Row[] {
  return Object.entries(rec).map(([k, v]) => ({ k, v }));
}

function rowsToRecord(rows: Row[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.k.trim();
    if (k) out[k] = r.v;
  }
  return out;
}

export function KeyValueEditor({
  label,
  value,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  addLabel = "Add",
}: {
  label?: string;
  value: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  addLabel?: string;
}) {
  const groupId = useId();
  // Local row state preserves order + lets a user type a key before it's valid.
  // We re-seed from `value` only when the externally-derived record diverges
  // from our own committed record (e.g. a reset), not on every keystroke.
  const [rows, setRows] = useState<Row[]>(() => recordToRows(value));
  const committed = useRef<Record<string, string>>(value);

  useEffect(() => {
    if (JSON.stringify(value) !== JSON.stringify(committed.current)) {
      committed.current = value;
      setRows(recordToRows(value));
    }
  }, [value]);

  function commit(next: Row[]) {
    setRows(next);
    const rec = rowsToRecord(next);
    committed.current = rec;
    onChange(rec);
  }

  function update(i: number, patch: Partial<Row>) {
    commit(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    commit(rows.filter((_, idx) => idx !== i));
  }
  function add() {
    setRows((r) => [...r, { k: "", v: "" }]);
  }

  const inputCls =
    "focus-ring min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[13px] text-foreground placeholder:text-faint";

  return (
    <div role="group" aria-labelledby={label ? `${groupId}-label` : undefined}>
      {label && (
        <div id={`${groupId}-label`} className="mb-1.5 text-xs font-medium text-muted-foreground">
          {label}
        </div>
      )}
      <div className="flex flex-col gap-2">
        {rows.length === 0 && <p className="text-xs text-faint">None.</p>}
        {rows.map((r, i) => (
          <div key={i} className="flex items-center gap-2">
            <input
              aria-label={`${label ?? "entry"} key ${i + 1}`}
              value={r.k}
              onChange={(e) => update(i, { k: e.target.value })}
              placeholder={keyPlaceholder}
              className={inputCls}
            />
            <span className="text-faint" aria-hidden>
              =
            </span>
            <input
              aria-label={`${label ?? "entry"} value ${i + 1}`}
              value={r.v}
              onChange={(e) => update(i, { v: e.target.value })}
              placeholder={valuePlaceholder}
              className={inputCls}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              aria-label={`Remove ${r.k || `row ${i + 1}`}`}
              className="focus-ring shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-error"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={add}
        className="focus-ring mt-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-primary hover:underline"
      >
        <Plus className="h-3.5 w-3.5" /> {addLabel}
      </button>
    </div>
  );
}
