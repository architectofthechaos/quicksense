"use client";
import { useCallback, useEffect, useState } from "react";
import { NotebookPen, Plus, FilePlus2 } from "lucide-react";
import type { Notebook, NotebookSummary, WorkspaceNode } from "@/lib/types";
import { buildWorkspaceTree } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";
import { WorkspaceTree } from "@/components/WorkspaceTree";
import { NotebookEditor } from "@/components/NotebookEditor";

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function NotebooksView() {
  const { toast } = useToast();
  const [notebooks, setNotebooks] = useState<NotebookSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/notebooks", { cache: "no-store" });
      if (!res.ok) {
        setError(await readError(res));
        setNotebooks([]);
        return;
      }
      const body = await res.json();
      setNotebooks((body.notebooks ?? []) as NotebookSummary[]);
      setError(null);
    } catch {
      setError("Could not reach the API.");
      setNotebooks([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const tree: WorkspaceNode[] = notebooks ? buildWorkspaceTree(notebooks) : [];

  async function onCreate(name: string, path: string) {
    setCreating(true);
    try {
      const body: Record<string, unknown> = { name: name.trim() };
      if (path.trim()) body.path = path.trim();
      const res = await fetch("/api/notebooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const nb = (await res.json()) as Notebook;
      setCreateOpen(false);
      toast("Notebook created");
      await load();
      setSelectedId(nb.id);
    } finally {
      setCreating(false);
    }
  }

  function onTrashed(id: string) {
    setSelectedId((s) => (s === id ? null : s));
    void load();
  }

  return (
    <section className="mx-auto flex h-[calc(100vh-7rem)] max-w-[1500px] flex-col">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Notebooks</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Author and run Python notebooks on a Spark cluster.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" /> New notebook
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 rounded-lg border px-4 py-2.5 text-sm"
          style={{
            color: "var(--error)",
            borderColor: "color-mix(in srgb, var(--error) 30%, var(--border))",
            background: "color-mix(in srgb, var(--error) 8%, var(--surface))",
          }}
        >
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr] gap-5">
        {/* Left — workspace */}
        <aside className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
            <span className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
              <NotebookPen className="h-3.5 w-3.5" /> Workspace
            </span>
            <button
              type="button"
              onClick={() => setCreateOpen(true)}
              aria-label="New notebook"
              className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <FilePlus2 className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-1">
            <WorkspacePane
              notebooks={notebooks}
              tree={tree}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={() => setCreateOpen(true)}
            />
          </div>
        </aside>

        {/* Right — editor */}
        <div className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-card">
          {selectedId ? (
            <NotebookEditor key={selectedId} notebookId={selectedId} onTrashed={onTrashed} />
          ) : (
            <NoSelection onCreate={() => setCreateOpen(true)} empty={notebooks?.length === 0} />
          )}
        </div>
      </div>

      <CreateNotebookDialog open={createOpen} busy={creating} onClose={() => setCreateOpen(false)} onSubmit={onCreate} />
    </section>
  );
}

function WorkspacePane({
  notebooks,
  tree,
  selectedId,
  onSelect,
  onCreate,
}: {
  notebooks: NotebookSummary[] | null;
  tree: WorkspaceNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}) {
  if (notebooks === null) {
    return (
      <div className="space-y-2 p-2" aria-busy="true" aria-label="Loading notebooks">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-7 animate-pulse rounded-md bg-muted" style={{ width: `${88 - i * 7}%` }} />
        ))}
      </div>
    );
  }
  if (notebooks.length === 0) {
    return (
      <div className="px-3 py-8 text-center">
        <p className="mb-1 text-sm font-medium text-foreground">No notebooks yet</p>
        <p className="mb-3 text-xs text-muted-foreground">Create your first notebook to get started.</p>
        <Button variant="secondary" onClick={onCreate}>
          <Plus className="h-4 w-4" /> New notebook
        </Button>
      </div>
    );
  }
  return <WorkspaceTree nodes={tree} selectedId={selectedId} onSelectNotebook={onSelect} />;
}

function NoSelection({ onCreate, empty }: { onCreate: () => void; empty: boolean | undefined }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
      <NotebookPen className="mb-4 h-12 w-12 text-faint" strokeWidth={1.5} />
      <p className="mb-1 text-base font-semibold text-foreground">{empty ? "Create a notebook" : "Select a notebook"}</p>
      <p className="mb-5 max-w-sm text-sm text-muted-foreground">
        {empty
          ? "You don’t have any notebooks yet. Create one to start authoring and running Python on Spark."
          : "Choose a notebook from the workspace to open it, or create a new one."}
      </p>
      <Button onClick={onCreate}>
        <Plus className="h-4 w-4" /> New notebook
      </Button>
    </div>
  );
}

function CreateNotebookDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string, path: string) => void;
}) {
  const [name, setName] = useState("");
  const [path, setPath] = useState("");

  useEffect(() => {
    if (open) {
      setName("");
      setPath("");
    }
  }, [open]);

  const valid = name.trim().length > 0;

  return (
    <Dialog open={open} onClose={onClose} title="New notebook">
      <p className="mb-5 mt-1 text-sm text-muted-foreground">Create a Python notebook in your workspace.</p>
      <div className="space-y-4">
        <div>
          <label htmlFor="nb-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Name
          </label>
          <input
            id="nb-name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && valid && !busy) onSubmit(name, path);
            }}
            placeholder="Exploratory analysis"
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
        </div>
        <div>
          <label htmlFor="nb-path" className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Folder path <span className="text-faint">(optional)</span>
          </label>
          <input
            id="nb-path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            placeholder="/Reports"
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-faint"
          />
          <p className="mt-1 text-xs text-faint">Group notebooks into folders, e.g. /Reports or /team/etl.</p>
        </div>
      </div>
      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => onSubmit(name, path)} disabled={busy || !valid}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </Dialog>
  );
}
