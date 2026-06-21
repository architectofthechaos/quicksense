"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Play,
  PlayCircle,
  Plus,
  Code,
  Type,
  Trash2,
  ChevronUp,
  ChevronDown,
  Pencil,
  Eye,
  Save,
  History,
  Share2,
  Download,
  Link2,
  CircleAlert,
  RotateCcw,
  X,
} from "lucide-react";
import type {
  Notebook,
  NotebookCell,
  NotebookContent,
  RunOutput,
  Revision,
  Permission,
  PermissionLevel,
  PrincipalType,
  Cluster,
} from "@/lib/types";
import { newCell, moveCell, normalizeContent, notebookDisplayName } from "@/lib/types";
import { notebookExportUrl } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { CodeEditor } from "@/components/CodeEditor";
import { Markdown } from "@/components/Markdown";
import { OutputRenderer, type CellRunState } from "@/components/OutputRenderer";

async function readError(res: Response): Promise<{ message: string; code?: string }> {
  try {
    const b = await res.json();
    return { message: b?.error?.message ?? `Request failed (${res.status})`, code: b?.error?.code };
  } catch {
    return { message: `Request failed (${res.status})` };
  }
}

// Per-cell run result kept in a map keyed by cell id.
type CellRun = { state: CellRunState; outputs: RunOutput[] | null; errorMessage?: string };

export function NotebookEditor({
  notebookId,
  onTrashed,
  onRenamed,
}: {
  notebookId: string;
  onTrashed?: (id: string) => void;
  onRenamed?: (nb: Notebook) => void;
}) {
  const { toast } = useToast();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [cells, setCells] = useState<NotebookCell[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [runs, setRuns] = useState<Record<string, CellRun>>({});

  const [historyOpen, setHistoryOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  // Load (or reload) the notebook whenever the selected id changes.
  const load = useCallback(async () => {
    setNotebook(null);
    setError(null);
    setDirty(false);
    setRuns({});
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}`, { cache: "no-store" });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      const nb = (await res.json()) as Notebook;
      setNotebook(nb);
      setCells(normalizeContent(nb.content).cells);
    } catch {
      setError("Could not reach the API.");
    }
  }, [notebookId]);

  useEffect(() => {
    void load();
  }, [load]);

  function updateCells(next: NotebookCell[]) {
    setCells(next);
    setDirty(true);
  }

  function setCellSource(id: string, source: string) {
    updateCells(cells.map((c) => (c.id === id ? { ...c, source } : c)));
  }
  function setCellType(id: string, type: "code" | "markdown") {
    updateCells(cells.map((c) => (c.id === id ? { ...c, type } : c)));
  }
  function addCell(type: "code" | "markdown", afterIndex: number) {
    const next = cells.slice();
    next.splice(afterIndex + 1, 0, newCell(type));
    updateCells(next);
  }
  function deleteCell(id: string) {
    updateCells(cells.filter((c) => c.id !== id));
    setRuns((r) => {
      const copy = { ...r };
      delete copy[id];
      return copy;
    });
  }
  function reorder(index: number, dir: "up" | "down") {
    updateCells(moveCell(cells, index, dir));
  }

  async function save() {
    if (!notebook) return;
    setSaving(true);
    try {
      const content: NotebookContent = { cells };
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      setNotebook((await res.json()) as Notebook);
      setDirty(false);
      toast("Notebook saved");
    } finally {
      setSaving(false);
    }
  }

  // Run a single cell (or, with no id, all cells). Markdown cells are skipped.
  // A 501 surfaces as the graceful "execution unavailable" state on the targeted
  // cell(s) rather than an error toast.
  const runCells = useCallback(
    async (targetId?: string) => {
      if (!notebook) return;
      const codeCellIds = cells.filter((c) => c.type === "code").map((c) => c.id);
      const ids = targetId ? [targetId] : codeCellIds;
      const runnable = ids.filter((id) => codeCellIds.includes(id));
      if (runnable.length === 0) return;

      setRuns((r) => {
        const next = { ...r };
        for (const id of runnable) next[id] = { state: "running", outputs: null };
        return next;
      });

      try {
        const res = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}/run`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(targetId ? { cell_id: targetId } : {}),
        });
        if (res.status === 501) {
          const { message } = await readError(res);
          setRuns((r) => {
            const next = { ...r };
            for (const id of runnable) next[id] = { state: "unavailable", outputs: null, errorMessage: message };
            return next;
          });
          return;
        }
        if (!res.ok) {
          const { message } = await readError(res);
          setRuns((r) => {
            const next = { ...r };
            for (const id of runnable) next[id] = { state: "error", outputs: null, errorMessage: message };
            return next;
          });
          return;
        }
        // Successful run: the API would return per-cell outputs. We accept either
        // {outputs:[...]} for a single cell or {results:{cellId:[...]}} for all.
        const body = (await res.json()) as { outputs?: RunOutput[]; results?: Record<string, RunOutput[]> };
        setRuns((r) => {
          const next = { ...r };
          if (body.results) {
            for (const id of runnable) next[id] = { state: "done", outputs: body.results[id] ?? [] };
          } else {
            for (const id of runnable) next[id] = { state: "done", outputs: body.outputs ?? [] };
          }
          return next;
        });
      } catch {
        setRuns((r) => {
          const next = { ...r };
          for (const id of runnable) next[id] = { state: "error", outputs: null, errorMessage: "Could not reach the API." };
          return next;
        });
      }
    },
    [notebook, cells],
  );

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
        <CircleAlert className="mb-3 h-10 w-10 text-error" strokeWidth={1.5} />
        <p className="mb-1 text-sm font-semibold text-foreground">Couldn’t open this notebook</p>
        <p className="text-sm text-muted-foreground">{error}</p>
        <div className="mt-4">
          <Button variant="secondary" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (!notebook) {
    return (
      <div className="space-y-3 p-6" aria-busy="true" aria-label="Loading notebook">
        <div className="h-9 w-72 animate-pulse rounded-md bg-muted" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Toolbar
        notebook={notebook}
        dirty={dirty}
        saving={saving}
        onSave={() => void save()}
        onRunAll={() => void runCells()}
        onOpenHistory={() => setHistoryOpen(true)}
        onOpenShare={() => setShareOpen(true)}
        onOpenAttach={() => setAttachOpen(true)}
        exportOpen={exportOpen}
        onToggleExport={() => setExportOpen((o) => !o)}
        onTrash={async () => {
          const res = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}`, { method: "DELETE" });
          if (res.ok || res.status === 204) {
            toast("Notebook moved to trash");
            onTrashed?.(notebook.id);
          } else {
            setError((await readError(res)).message);
          }
        }}
      />

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        <div className="mx-auto max-w-[60rem] space-y-3">
          {cells.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-surface p-10 text-center">
              <p className="mb-1 text-sm font-semibold text-foreground">This notebook is empty</p>
              <p className="mb-4 text-sm text-muted-foreground">Add a cell to get started.</p>
              <div className="flex justify-center gap-2">
                <Button variant="secondary" onClick={() => addCell("code", -1)}>
                  <Code className="h-4 w-4" /> Code cell
                </Button>
                <Button variant="secondary" onClick={() => addCell("markdown", -1)}>
                  <Type className="h-4 w-4" /> Markdown cell
                </Button>
              </div>
            </div>
          ) : (
            cells.map((cell, i) => (
              <CellView
                key={cell.id}
                cell={cell}
                index={i}
                total={cells.length}
                run={runs[cell.id] ?? { state: "idle", outputs: null }}
                onSourceChange={(s) => setCellSource(cell.id, s)}
                onTypeChange={(ty) => setCellType(cell.id, ty)}
                onRun={() => void runCells(cell.id)}
                onDelete={() => deleteCell(cell.id)}
                onMoveUp={() => reorder(i, "up")}
                onMoveDown={() => reorder(i, "down")}
                onAddBelow={(ty) => addCell(ty, i)}
              />
            ))
          )}
        </div>
      </div>

      <Drawer open={historyOpen} onClose={() => setHistoryOpen(false)} title="Version history">
        <RevisionHistory
          notebookId={notebook.id}
          onRestored={(nb) => {
            setNotebook(nb);
            setCells(normalizeContent(nb.content).cells);
            setDirty(false);
            setHistoryOpen(false);
            toast("Revision restored");
          }}
          onSnapshot={() => toast("Revision saved")}
        />
      </Drawer>

      <ShareDialog open={shareOpen} notebookId={notebook.id} onClose={() => setShareOpen(false)} />

      <AttachDialog
        open={attachOpen}
        notebook={notebook}
        onClose={() => setAttachOpen(false)}
        onAttached={(nb) => {
          setNotebook(nb);
          setAttachOpen(false);
          toast("Cluster attached");
        }}
      />
    </div>
  );
}

// ── Toolbar ──────────────────────────────────────────────────────────────────

function Toolbar({
  notebook,
  dirty,
  saving,
  onSave,
  onRunAll,
  onOpenHistory,
  onOpenShare,
  onOpenAttach,
  exportOpen,
  onToggleExport,
  onTrash,
}: {
  notebook: Notebook;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
  onRunAll: () => void;
  onOpenHistory: () => void;
  onOpenShare: () => void;
  onOpenAttach: () => void;
  exportOpen: boolean;
  onToggleExport: () => void;
  onTrash: () => void;
}) {
  const exportRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!exportOpen) return;
    const onDoc = (e: MouseEvent) => {
      if (exportRef.current && !exportRef.current.contains(e.target as Node)) onToggleExport();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [exportOpen, onToggleExport]);

  return (
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
      <div className="min-w-0">
        <p className="truncate font-mono text-[11px] uppercase tracking-[0.06em] text-faint">{notebook.path || "/"}</p>
        <h2 className="flex items-center gap-2 truncate text-lg font-semibold text-foreground">
          {notebookDisplayName(notebook)}
          {dirty && (
            <span className="text-xs font-normal text-warning" title="Unsaved changes">
              · unsaved
            </span>
          )}
        </h2>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onOpenAttach}
          className="focus-ring inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
        >
          <Link2 className="h-3.5 w-3.5" />
          {notebook.attached_cluster_id ? "Attached" : "Attach cluster"}
          {notebook.attached_cluster_id && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-hidden />}
        </button>
        <Button variant="ghost" onClick={onRunAll} title="Run all cells">
          <PlayCircle className="h-4 w-4" /> Run all
        </Button>
        <Button variant="ghost" onClick={onOpenHistory} title="Version history">
          <History className="h-4 w-4" /> History
        </Button>
        <Button variant="ghost" onClick={onOpenShare} title="Share">
          <Share2 className="h-4 w-4" /> Share
        </Button>
        <div className="relative" ref={exportRef}>
          <Button variant="ghost" aria-haspopup="menu" aria-expanded={exportOpen} onClick={onToggleExport} title="Export">
            <Download className="h-4 w-4" /> Export
          </Button>
          {exportOpen && (
            <div role="menu" className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop">
              <a
                role="menuitem"
                href={notebookExportUrl(notebook.id, "ipynb")}
                className="focus-ring block px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
              >
                Jupyter (.ipynb)
              </a>
              <a
                role="menuitem"
                href={notebookExportUrl(notebook.id, "py")}
                className="focus-ring block px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
              >
                Python (.py)
              </a>
            </div>
          )}
        </div>
        <Button variant="destructive" onClick={onTrash} title="Move to trash">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button onClick={onSave} disabled={saving || !dirty}>
          <Save className="h-4 w-4" /> {saving ? "Saving…" : "Save"}
        </Button>
      </div>
    </header>
  );
}

// ── Cell ───────────────────────────────────────────────────────────────────

function CellView({
  cell,
  index,
  total,
  run,
  onSourceChange,
  onTypeChange,
  onRun,
  onDelete,
  onMoveUp,
  onMoveDown,
  onAddBelow,
}: {
  cell: NotebookCell;
  index: number;
  total: number;
  run: CellRun;
  onSourceChange: (s: string) => void;
  onTypeChange: (ty: "code" | "markdown") => void;
  onRun: () => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onAddBelow: (ty: "code" | "markdown") => void;
}) {
  const isCode = cell.type === "code";
  // Markdown cells start in "rendered" mode unless empty; toggle to edit.
  const [editingMd, setEditingMd] = useState(cell.source.trim() === "");

  return (
    <div className="group rounded-lg border border-border bg-surface shadow-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-1.5">
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {isCode ? "Python" : "Markdown"}
          </span>
          {isCode && (
            <button
              type="button"
              onClick={onRun}
              aria-label={`Run cell ${index + 1}`}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Play className="h-3.5 w-3.5" /> Run
            </button>
          )}
          {!isCode && (
            <button
              type="button"
              onClick={() => setEditingMd((e) => !e)}
              aria-label={editingMd ? `Preview markdown cell ${index + 1}` : `Edit markdown cell ${index + 1}`}
              className="focus-ring inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              {editingMd ? <Eye className="h-3.5 w-3.5" /> : <Pencil className="h-3.5 w-3.5" />}
              {editingMd ? "Preview" : "Edit"}
            </button>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          <button
            type="button"
            onClick={() => onTypeChange(isCode ? "markdown" : "code")}
            title={isCode ? "Convert to markdown" : "Convert to code"}
            aria-label={isCode ? "Convert to markdown" : "Convert to code"}
            className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            {isCode ? <Type className="h-3.5 w-3.5" /> : <Code className="h-3.5 w-3.5" />}
          </button>
          <button
            type="button"
            onClick={onMoveUp}
            disabled={index === 0}
            title="Move up"
            aria-label={`Move cell ${index + 1} up`}
            className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronUp className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onMoveDown}
            disabled={index === total - 1}
            title="Move down"
            aria-label={`Move cell ${index + 1} down`}
            className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            title="Delete cell"
            aria-label={`Delete cell ${index + 1}`}
            className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--error)_10%,var(--surface))] hover:text-error"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="px-3 py-2.5">
        {isCode ? (
          <CodeEditor value={cell.source} onChange={onSourceChange} ariaLabel={`Code cell ${index + 1}`} />
        ) : editingMd ? (
          <textarea
            aria-label={`Markdown cell ${index + 1}`}
            value={cell.source}
            spellCheck={false}
            onChange={(e) => onSourceChange(e.target.value)}
            onBlur={() => cell.source.trim() !== "" && setEditingMd(false)}
            rows={Math.max(3, cell.source.split("\n").length)}
            placeholder="# Markdown — supports headings, **bold**, lists, `code`, links"
            className="focus-ring block w-full resize-y rounded-md border border-border bg-surface-2 px-3 py-2.5 font-mono text-[13px] leading-relaxed text-foreground placeholder:text-faint"
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingMd(true)}
            className="focus-ring block w-full cursor-text rounded-md px-1 text-left"
            aria-label={`Markdown cell ${index + 1} preview, click to edit`}
          >
            <Markdown source={cell.source} />
          </button>
        )}
      </div>

      {isCode && <OutputRenderer state={run.state} outputs={run.outputs} errorMessage={run.errorMessage} />}

      {/* Insert-below affordance */}
      <div className="flex items-center justify-center gap-1 border-t border-border py-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          onClick={() => onAddBelow("code")}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Code
        </button>
        <button
          type="button"
          onClick={() => onAddBelow("markdown")}
          className="focus-ring inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-3 w-3" /> Markdown
        </button>
      </div>
    </div>
  );
}

// ── Revision history ─────────────────────────────────────────────────────────

function RevisionHistory({
  notebookId,
  onRestored,
  onSnapshot,
}: {
  notebookId: string;
  onRestored: (nb: Notebook) => void;
  onSnapshot: () => void;
}) {
  const [revisions, setRevisions] = useState<Revision[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/revisions`, { cache: "no-store" });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      setRevisions(((await res.json()).revisions ?? []) as Revision[]);
    } catch {
      setError("Could not reach the API.");
    }
  }, [notebookId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function snapshot() {
    setBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/revisions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: message.trim() }),
      });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      setMessage("");
      onSnapshot();
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function restore(rev: Revision) {
    setBusy(true);
    try {
      const res = await fetch(
        `/api/notebooks/${encodeURIComponent(notebookId)}/revisions/${encodeURIComponent(rev.id)}/restore`,
        { method: "POST" },
      );
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      onRestored((await res.json()) as Notebook);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <label htmlFor="rev-msg" className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Save a revision
        </label>
        <div className="flex gap-2">
          <input
            id="rev-msg"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Checkpoint message (optional)"
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
          <Button onClick={() => void snapshot()} disabled={busy}>
            <Save className="h-4 w-4" /> Save
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-error">{error}</p>}

      {revisions === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
      ) : revisions.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No revisions yet. Save one to start a history.</p>
      ) : (
        <ul className="space-y-2">
          {revisions.map((rev) => (
            <li key={rev.id} className="flex items-start justify-between gap-3 rounded-lg border border-border bg-surface p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-foreground">{rev.message || "(no message)"}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {rev.author || "unknown"} · {rev.created_at}
                </p>
              </div>
              <button
                type="button"
                onClick={() => void restore(rev)}
                disabled={busy}
                className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Share dialog ─────────────────────────────────────────────────────────────

const LEVELS: PermissionLevel[] = ["view", "run", "edit", "manage"];

function ShareDialog({ open, notebookId, onClose }: { open: boolean; notebookId: string; onClose: () => void }) {
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  const [principalId, setPrincipalId] = useState("");
  const [level, setLevel] = useState<PermissionLevel>("view");

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/permissions`, { cache: "no-store" });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      setPerms(((await res.json()).permissions ?? []) as Permission[]);
    } catch {
      setError("Could not reach the API.");
    }
  }, [notebookId]);

  useEffect(() => {
    if (open) {
      setPerms(null);
      setPrincipalId("");
      void load();
    }
  }, [open, load]);

  async function grant() {
    const pid = principalId.trim();
    if (!pid) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/permissions`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal_type: principalType, principal_id: pid, level }),
      });
      if (!res.ok && res.status !== 204) {
        setError((await readError(res)).message);
        return;
      }
      setPrincipalId("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(p: Permission) {
    setBusy(true);
    try {
      const qs = `principal_type=${encodeURIComponent(p.principal_type)}&principal_id=${encodeURIComponent(p.principal_id)}`;
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebookId)}/permissions?${qs}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setError((await readError(res)).message);
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Dialog open={open} onClose={onClose} title="Share notebook">
      <p className="mb-4 mt-1 text-sm text-muted-foreground">
        Grant a user or group access at a chosen level. Enforcement is server-side (Phase 4e).
      </p>

      <div className="space-y-2 rounded-lg border border-border bg-surface-2 p-3">
        <div className="flex flex-wrap gap-2">
          <select
            aria-label="Principal type"
            value={principalType}
            onChange={(e) => setPrincipalType(e.target.value as PrincipalType)}
            className="focus-ring rounded-lg border border-border bg-background px-2.5 py-2 text-sm text-foreground"
          >
            <option value="user">User</option>
            <option value="group">Group</option>
          </select>
          <input
            aria-label="Principal id"
            value={principalId}
            onChange={(e) => setPrincipalId(e.target.value)}
            placeholder={principalType === "user" ? "username" : "group name"}
            className="focus-ring min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
          <select
            aria-label="Permission level"
            value={level}
            onChange={(e) => setLevel(e.target.value as PermissionLevel)}
            className="focus-ring rounded-lg border border-border bg-background px-2.5 py-2 text-sm capitalize text-foreground"
          >
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
          <Button onClick={() => void grant()} disabled={busy || principalId.trim() === ""}>
            Grant
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-error">{error}</p>}

      <div className="mt-4 max-h-[40vh] overflow-y-auto">
        {perms === null ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading permissions…</p>
        ) : perms.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No one else has access yet.</p>
        ) : (
          <ul className="space-y-1.5">
            {perms.map((p) => (
              <li
                key={`${p.principal_type}:${p.principal_id}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2"
              >
                <div className="min-w-0">
                  <span className="truncate text-sm font-medium text-foreground">{p.principal_id}</span>
                  <span className="ml-2 text-xs text-muted-foreground">{p.principal_type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge kind="unknown">{p.level}</Badge>
                  <button
                    type="button"
                    onClick={() => void revoke(p)}
                    disabled={busy}
                    aria-label={`Revoke access for ${p.principal_id}`}
                    className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--error)_10%,var(--surface))] hover:text-error disabled:opacity-50"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      </div>
    </Dialog>
  );
}

// ── Attach-cluster picker ────────────────────────────────────────────────────

function AttachDialog({
  open,
  notebook,
  onClose,
  onAttached,
}: {
  open: boolean;
  notebook: Notebook;
  onClose: () => void;
  onAttached: (nb: Notebook) => void;
}) {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClusters(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/clusters", { cache: "no-store" });
        if (!res.ok) {
          setError((await readError(res)).message);
          return;
        }
        setClusters(((await res.json()).clusters ?? []) as Cluster[]);
      } catch {
        setError("Could not reach the API.");
      }
    })();
  }, [open]);

  async function attach(c: Cluster) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/notebooks/${encodeURIComponent(notebook.id)}/attach`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cluster_id: c.id }),
      });
      if (!res.ok) {
        setError((await readError(res)).message);
        return;
      }
      onAttached((await res.json()) as Notebook);
    } finally {
      setBusyId(null);
    }
  }

  if (!open) return null;

  // Offer running clusters first; a cluster is "runnable" when ready or phase Running.
  const runnable = (c: Cluster) => c.ready || (c.phase ?? "").toLowerCase().includes("running");

  return (
    <Dialog open={open} onClose={onClose} title="Attach to a cluster">
      <p className="mb-4 mt-1 text-sm text-muted-foreground">Choose a running cluster to execute this notebook against.</p>

      {error && <p className="mb-3 text-sm text-error">{error}</p>}

      {clusters === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading clusters…</p>
      ) : clusters.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No clusters available. Create one in Clusters first.</p>
      ) : (
        <ul className="max-h-[45vh] space-y-1.5 overflow-y-auto">
          {clusters.map((c) => {
            const ok = runnable(c);
            const attached = notebook.attached_cluster_id === c.id;
            return (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.ready ? "Ready" : c.phase || "Unknown"}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void attach(c)}
                  disabled={!ok || busyId === c.id || attached}
                  className="focus-ring inline-flex shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40 disabled:pointer-events-none"
                >
                  {attached ? "Attached" : busyId === c.id ? "Attaching…" : ok ? "Attach" : "Not running"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}
