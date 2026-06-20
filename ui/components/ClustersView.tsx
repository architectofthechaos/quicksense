"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Cluster } from "@/lib/types";
import { phaseToBadge, isTerminalReady } from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";

const POLL_MS = 4000;

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function ClustersView() {
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/clusters", { cache: "no-store" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      const body = await res.json();
      setClusters(body.clusters ?? []);
      setError(null);
    } catch {
      setError("Could not reach the API.");
    }
  }, []);

  // Initial load.
  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any cluster is still settling (not terminal-ready).
  useEffect(() => {
    if (!clusters) return;
    const needsPoll = clusters.some((c) => !isTerminalReady(c));
    if (!needsPoll) return;
    timer.current = setTimeout(() => {
      void load();
    }, POLL_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [clusters, load]);

  async function onCreate() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setBusy(true);
    try {
      const res = await fetch("/api/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setDialogOpen(false);
      setName("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/clusters/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      await load();
    } finally {
      setBusy(false);
    }
  }

  const settling = clusters?.some((c) => !isTerminalReady(c)) ?? false;

  return (
    <section>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Clusters</h1>
          <p className="mt-1 text-sm text-slate-500">
            Interactive Spark Connect clusters
            {settling && <span className="ml-2 text-amber-600">· refreshing status…</span>}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <span aria-hidden className="text-base leading-none">+</span> Create cluster
        </Button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-4 py-2.5 text-sm text-rose-700"
        >
          <span aria-hidden className="mt-0.5 font-semibold">!</span>
          <span>{error}</span>
        </div>
      )}

      {clusters === null ? (
        <div className="rounded-lg border border-surface-border bg-surface p-10 text-center text-sm text-slate-500">
          Loading clusters…
        </div>
      ) : clusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-surface-border bg-surface p-12 text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-muted font-mono text-accent" aria-hidden>
            ⌗
          </div>
          <p className="mb-1 font-medium text-slate-800">No clusters yet</p>
          <p className="text-sm text-slate-500">Create an interactive cluster to get started.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-surface-border bg-surface shadow-sm">
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Status</Th>
                <Th>CR name</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {clusters.map((c) => {
                const b = phaseToBadge(c);
                return (
                  <Tr key={c.id}>
                    <Td className="font-medium text-slate-800">{c.name}</Td>
                    <Td>
                      <Badge kind={b.kind}>{b.label}</Badge>
                    </Td>
                    <Td className="font-mono text-xs text-slate-500">{c.cr_name}</Td>
                    <Td className="text-right">
                      <Button variant="danger" disabled={busy} onClick={() => onDelete(c.id)}>
                        Delete
                      </Button>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      )}

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Create cluster">
        <p className="mb-4 text-sm text-slate-500">Provision a new interactive Spark Connect cluster.</p>
        <label className="mb-1.5 block text-sm font-medium text-slate-700" htmlFor="cluster-name">
          Name
        </label>
        <input
          id="cluster-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void onCreate();
          }}
          className="mb-5 w-full rounded-md border border-surface-border px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30"
          placeholder="my-cluster"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </Dialog>
    </section>
  );
}
