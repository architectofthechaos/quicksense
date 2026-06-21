"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Link2, Copy } from "lucide-react";
import type { Cluster } from "@/lib/types";
import { phaseToBadge, isTerminalReady, connectUrl } from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { useToast } from "@/components/ui/Toast";
import { Mark } from "@/components/brand/Logo";

const POLL_MS = 4000;

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable (insecure context / denied) — non-fatal */
  }
}

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export function ClustersView() {
  const { toast } = useToast();
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Cluster | null>(null);
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

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!clusters) return;
    if (!clusters.some((c) => !isTerminalReady(c))) return;
    timer.current = setTimeout(() => void load(), POLL_MS);
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
      toast("Cluster created");
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
      setSelected((s) => (s?.id === id ? null : s));
      toast("Cluster deleted");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function onConnect(c: Cluster) {
    await copyText(connectUrl(c.cr_name));
    toast("Connection URL copied");
  }

  const settling = clusters?.some((c) => !isTerminalReady(c)) ?? false;

  return (
    <section>
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Clusters</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Interactive Spark Connect clusters
            {settling && <span className="ml-2 text-warning">· refreshing status…</span>}
          </p>
        </div>
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> Create cluster
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

      {clusters === null ? (
        <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground shadow-card">
          Loading clusters…
        </div>
      ) : clusters.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-surface p-14 text-center shadow-card">
          <Mark className="mx-auto mb-4 h-12 w-12 opacity-40" />
          <p className="mb-1 text-base font-semibold text-foreground">No clusters yet</p>
          <p className="mb-5 text-sm text-muted-foreground">Create your first interactive Spark Connect cluster.</p>
          <div className="flex justify-center">
            <Button onClick={() => setDialogOpen(true)}>
              <Plus className="h-4 w-4" /> Create cluster
            </Button>
          </div>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
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
                  <Tr
                    key={c.id}
                    onClick={() => setSelected(c)}
                    className="cursor-pointer transition-colors hover:bg-muted"
                  >
                    <Td className="whitespace-nowrap font-medium text-foreground">{c.name}</Td>
                    <Td>
                      <Badge kind={b.kind}>{b.label}</Badge>
                    </Td>
                    <Td>
                      <button
                        type="button"
                        title="Copy CR name"
                        onClick={(e) => {
                          e.stopPropagation();
                          void copyText(c.cr_name);
                          toast("CR name copied");
                        }}
                        className="focus-ring max-w-[220px] truncate rounded font-mono text-[13px] text-muted-foreground hover:text-foreground"
                      >
                        {c.cr_name}
                      </button>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          variant="ghost"
                          onClick={(e) => {
                            e.stopPropagation();
                            void onConnect(c);
                          }}
                        >
                          <Link2 className="h-4 w-4" /> Connect
                        </Button>
                        <Button
                          variant="destructive"
                          disabled={busy}
                          onClick={(e) => {
                            e.stopPropagation();
                            void onDelete(c.id);
                          }}
                        >
                          Delete
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      )}

      {/* Create modal */}
      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)} title="Create interactive cluster">
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          Provision a new interactive Spark Connect cluster.
        </p>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground" htmlFor="cluster-name">
          Name
        </label>
        <input
          id="cluster-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void onCreate()}
          className="focus-ring mb-5 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          placeholder="my-cluster"
          autoFocus
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setDialogOpen(false)}>
            Cancel
          </Button>
          <Button onClick={onCreate} disabled={busy || !name.trim()}>
            {busy ? "Creating…" : "Create"}
          </Button>
        </div>
      </Dialog>

      {/* Detail drawer */}
      <Drawer open={selected !== null} onClose={() => setSelected(null)} title="Cluster details">
        {selected && <ClusterDetail cluster={selected} onConnect={() => onConnect(selected)} />}
      </Drawer>
    </section>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-border py-3 last:border-0">
      <div className="mb-1 text-xs font-medium uppercase tracking-[0.04em] text-muted-foreground">{label}</div>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

function ClusterDetail({ cluster, onConnect }: { cluster: Cluster; onConnect: () => void }) {
  const b = phaseToBadge(cluster);
  const url = connectUrl(cluster.cr_name);
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-lg font-semibold text-foreground">{cluster.name}</span>
        <Badge kind={b.kind}>{b.label}</Badge>
      </div>
      <DetailRow label="Namespace">{cluster.namespace}</DetailRow>
      <DetailRow label="CR name">
        <span className="font-mono text-[13px] text-muted-foreground">{cluster.cr_name}</span>
      </DetailRow>
      <DetailRow label="Phase">{cluster.phase || "Unknown"}</DetailRow>
      <DetailRow label="Connect">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[13px] text-foreground">
            {url}
          </code>
          <Button variant="ghost" onClick={onConnect} aria-label="Copy connect URL">
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </DetailRow>
    </div>
  );
}
