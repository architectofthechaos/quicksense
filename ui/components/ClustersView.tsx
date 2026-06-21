"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  Plus,
  Link2,
  Copy,
  MoreHorizontal,
  Play,
  Square,
  RotateCw,
  CopyPlus,
  Pin,
  PinOff,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import type { Cluster, ClusterConfig, ClusterEvent, ClusterMetrics, ResourceSpec } from "@/lib/types";
import {
  phaseToBadge,
  isTerminalReady,
  connectUrl,
  formatAge,
  resourceSummary,
  defaultClusterConfig,
  normalizeClusterConfig,
} from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { Drawer } from "@/components/ui/Drawer";
import { Tabs } from "@/components/ui/Tabs";
import { useToast } from "@/components/ui/Toast";
import { KeyValueEditor } from "@/components/KeyValueEditor";
import { ResourceField } from "@/components/ResourceField";
import { LogViewer } from "@/components/LogViewer";
import { PermissionsEditor } from "@/components/PermissionsEditor";
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

// desired_state defaults to "Running" when the API omits it (a freshly created
// cluster). We treat anything not explicitly "Stopped" as running for gating.
function isStopped(c: Cluster): boolean {
  return c.desired_state === "Stopped";
}

export function ClustersView() {
  const { toast } = useToast();
  const [clusters, setClusters] = useState<Cluster[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  const selected = clusters?.find((c) => c.id === selectedId) ?? null;

  async function onCreate(config: ClusterConfig) {
    setCreating(true);
    try {
      const res = await fetch("/api/clusters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      setCreateOpen(false);
      toast("Cluster created");
      await load();
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(c: Cluster) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/clusters/${c.id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      setSelectedId((s) => (s === c.id ? null : s));
      toast("Cluster deleted");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // POST a lifecycle/clone action via the passthrough route.
  async function onAction(c: Cluster, action: "start" | "stop" | "restart" | "clone", successMsg: string) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/clusters/${c.id}/${action}`, { method: "POST" });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      toast(successMsg);
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function onTogglePin(c: Cluster) {
    setBusyId(c.id);
    try {
      const res = await fetch(`/api/clusters/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: !c.pinned }),
      });
      if (!res.ok) {
        setError(await readError(res));
        return;
      }
      toast(c.pinned ? "Cluster unpinned" : "Cluster pinned");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  async function onConnect(c: Cluster) {
    await copyText(connectUrl(c.cr_name));
    toast("Connection URL copied");
  }

  const settling = clusters?.some((c) => !isTerminalReady(c)) ?? false;

  return (
    <section className="mx-auto max-w-[1400px]">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Clusters</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Production Spark Connect clusters on Kubernetes
            {settling && <span className="ml-2 text-warning">· refreshing status…</span>}
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
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
          <p className="mb-5 text-sm text-muted-foreground">Create your first production Spark Connect cluster.</p>
          <div className="flex justify-center">
            <Button onClick={() => setCreateOpen(true)}>
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
                <Th>Workers</Th>
                <Th>Driver</Th>
                <Th>Executor</Th>
                <Th>Age</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {clusters.map((c) => {
                const b = phaseToBadge(c);
                const cfg = c.config;
                return (
                  <Tr
                    key={c.id}
                    onClick={() => setSelectedId(c.id)}
                    className="cursor-pointer transition-colors hover:bg-muted"
                  >
                    <Td className="whitespace-nowrap font-medium text-foreground">
                      <span className="inline-flex items-center gap-1.5">
                        {c.pinned && <Pin className="h-3.5 w-3.5 text-primary" aria-label="Pinned" />}
                        {c.name}
                      </span>
                    </Td>
                    <Td>
                      <Badge kind={b.kind}>{b.label}</Badge>
                    </Td>
                    <Td className="whitespace-nowrap text-muted-foreground">
                      {cfg ? `${cfg.worker_min}–${cfg.worker_max}` : "—"}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {resourceSummary(cfg?.driver)}
                    </Td>
                    <Td className="whitespace-nowrap font-mono text-[12px] text-muted-foreground">
                      {resourceSummary(cfg?.executor)}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums text-muted-foreground">{formatAge(c.created_at)}</Td>
                    <Td className="text-right" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" onClick={() => void onConnect(c)} title="Copy Spark Connect URL">
                          <Link2 className="h-4 w-4" /> Connect
                        </Button>
                        <RowMenu
                          cluster={c}
                          busy={busyId === c.id}
                          onStart={() => onAction(c, "start", "Cluster starting")}
                          onStop={() => onAction(c, "stop", "Cluster stopping")}
                          onRestart={() => onAction(c, "restart", "Cluster restarting")}
                          onClone={() => onAction(c, "clone", "Cluster cloned")}
                          onTogglePin={() => onTogglePin(c)}
                          onDelete={() => onDelete(c)}
                        />
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </Tbody>
          </Table>
        </div>
      )}

      <CreateClusterDialog open={createOpen} busy={creating} onClose={() => setCreateOpen(false)} onSubmit={onCreate} />

      <Drawer open={selected !== null} onClose={() => setSelectedId(null)} title="Cluster details">
        {selected && <ClusterDetail cluster={selected} onConnect={() => onConnect(selected)} />}
      </Drawer>
    </section>
  );
}

// ── Row actions menu ─────────────────────────────────────────────────────────

function RowMenu({
  cluster,
  busy,
  onStart,
  onStop,
  onRestart,
  onClone,
  onTogglePin,
  onDelete,
}: {
  cluster: Cluster;
  busy: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onClone: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

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

  const stopped = isStopped(cluster);
  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  function item(
    key: string,
    label: string,
    Icon: typeof Play,
    fn: () => void,
    opts: { disabled?: boolean; danger?: boolean } = {},
  ) {
    return (
      <button
        key={key}
        type="button"
        role="menuitem"
        disabled={opts.disabled || busy}
        onClick={run(fn)}
        className={`focus-ring flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-sm transition-colors disabled:opacity-40 disabled:pointer-events-none ${
          opts.danger
            ? "text-error hover:bg-[color-mix(in_srgb,var(--error)_10%,var(--surface))]"
            : "text-foreground hover:bg-muted"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0" /> {label}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${cluster.name}`}
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
        className="focus-ring rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-lg border border-border bg-surface py-1 shadow-pop"
        >
          {/* Gating reflects desired_state: a Stopped cluster can Start; a Running
              one can Stop/Restart. Clone/Pin/Delete always apply. */}
          {item("start", "Start", Play, onStart, { disabled: !stopped })}
          {item("stop", "Stop", Square, onStop, { disabled: stopped })}
          {item("restart", "Restart", RotateCw, onRestart, { disabled: stopped })}
          {item("clone", "Clone", CopyPlus, onClone)}
          {cluster.pinned
            ? item("unpin", "Unpin", PinOff, onTogglePin)
            : item("pin", "Pin", Pin, onTogglePin)}
          <div className="my-1 border-t border-border" />
          {item("delete", "Delete", Trash2, onDelete, { danger: true })}
        </div>
      )}
    </div>
  );
}

// ── Create form ──────────────────────────────────────────────────────────────

function numInput(value: number, onChange: (n: number) => void, props: { id: string; min?: number; "aria-label"?: string }) {
  return (
    <input
      {...props}
      type="number"
      value={Number.isFinite(value) ? value : ""}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums text-foreground placeholder:text-faint"
    />
  );
}

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}

function CreateClusterDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (config: ClusterConfig) => void;
}) {
  const [cfg, setCfg] = useState<ClusterConfig>(() => defaultClusterConfig());
  const [advanced, setAdvanced] = useState(false);

  // Reset the form each time the dialog opens so a prior draft doesn't leak.
  useEffect(() => {
    if (open) {
      setCfg(defaultClusterConfig());
      setAdvanced(false);
    }
  }, [open]);

  const set = (patch: Partial<ClusterConfig>) => setCfg((c) => ({ ...c, ...patch }));
  const setDriver = (driver: ResourceSpec) => set({ driver });
  const setExecutor = (executor: ResourceSpec) => set({ executor });

  const nameValid = cfg.name.trim().length > 0;

  function submit() {
    if (!nameValid) return;
    onSubmit(normalizeClusterConfig(cfg));
  }

  return (
    <Dialog open={open} onClose={onClose} title="Create production cluster">
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Provision a Spark Connect cluster with pod resources against the Kubernetes cluster.
      </p>

      <div className="max-h-[60vh] space-y-5 overflow-y-auto pr-1">
        <div>
          <FieldLabel htmlFor="c-name">Name</FieldLabel>
          <input
            id="c-name"
            value={cfg.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="my-cluster"
            autoFocus
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel htmlFor="c-wmin">Min workers</FieldLabel>
            {numInput(cfg.worker_min, (n) => set({ worker_min: n }), { id: "c-wmin", min: 0, "aria-label": "Min workers" })}
          </div>
          <div>
            <FieldLabel htmlFor="c-wmax">Max workers</FieldLabel>
            {numInput(cfg.worker_max, (n) => set({ worker_max: n }), { id: "c-wmax", min: 0, "aria-label": "Max workers" })}
          </div>
        </div>

        <ResourceField label="Driver" value={cfg.driver} onChange={setDriver} />
        <ResourceField label="Executor" value={cfg.executor} onChange={setExecutor} />

        <div>
          <FieldLabel htmlFor="c-idle">Auto-terminate after idle (minutes)</FieldLabel>
          {numInput(cfg.idle_minutes, (n) => set({ idle_minutes: n }), { id: "c-idle", min: 0, "aria-label": "Idle minutes" })}
          <p className="mt-1 text-xs text-faint">0 disables auto-termination. Pinned clusters are never auto-stopped.</p>
        </div>

        {/* Advanced */}
        <div className="rounded-lg border border-border">
          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((a) => !a)}
            className="focus-ring flex w-full items-center gap-2 px-3 py-2.5 text-sm font-medium text-foreground"
          >
            {advanced ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            Advanced
          </button>
          {advanced && (
            <div className="space-y-4 border-t border-border px-3 py-4">
              <div>
                <FieldLabel htmlFor="c-image">Spark image override</FieldLabel>
                <input
                  id="c-image"
                  value={cfg.image}
                  onChange={(e) => set({ image: e.target.value })}
                  placeholder="registry.local/quicksense/spark:latest"
                  className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-faint"
                />
                <p className="mt-1 text-xs text-faint">Leave blank to use the platform default image.</p>
              </div>
              <KeyValueEditor
                label="Spark configuration"
                value={cfg.spark_conf}
                onChange={(spark_conf) => set({ spark_conf })}
                keyPlaceholder="spark.sql.shuffle.partitions"
                valuePlaceholder="8"
                addLabel="Add config"
              />
              <KeyValueEditor
                label="Environment variables"
                value={cfg.env}
                onChange={(env) => set({ env })}
                keyPlaceholder="LOG_LEVEL"
                valuePlaceholder="INFO"
                addLabel="Add variable"
              />
              <KeyValueEditor
                label="Tags (labels)"
                value={cfg.tags}
                onChange={(tags) => set({ tags })}
                keyPlaceholder="team"
                valuePlaceholder="data"
                addLabel="Add tag"
              />
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={busy || !nameValid}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Detail drawer ──────────────────────────────────────────────────────────────

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
  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="inline-flex items-center gap-2 text-lg font-semibold text-foreground">
          {cluster.pinned && <Pin className="h-4 w-4 text-primary" aria-label="Pinned" />}
          {cluster.name}
        </span>
        <Badge kind={b.kind}>{b.label}</Badge>
      </div>
      <Tabs
        items={[
          { id: "overview", label: "Overview", content: <OverviewTab cluster={cluster} onConnect={onConnect} /> },
          { id: "events", label: "Events", content: <EventsTab clusterId={cluster.id} /> },
          { id: "logs", label: "Driver logs", content: <LogViewer clusterId={cluster.id} /> },
          { id: "metrics", label: "Metrics", content: <MetricsTab clusterId={cluster.id} /> },
          { id: "permissions", label: "Permissions", content: <PermissionsTab clusterId={cluster.id} /> },
        ]}
      />
    </div>
  );
}

function OverviewTab({ cluster, onConnect }: { cluster: Cluster; onConnect: () => void }) {
  const url = connectUrl(cluster.cr_name);
  const cfg = cluster.config;
  return (
    <div>
      <DetailRow label="Phase">{cluster.phase || "Unknown"}</DetailRow>
      <DetailRow label="Desired state">{cluster.desired_state || "Running"}</DetailRow>
      <DetailRow label="Namespace">{cluster.namespace}</DetailRow>
      <DetailRow label="CR name">
        <span className="font-mono text-[13px] text-muted-foreground">{cluster.cr_name}</span>
      </DetailRow>
      {cfg && (
        <>
          <DetailRow label="Workers">
            {cfg.worker_min}–{cfg.worker_max}
          </DetailRow>
          <DetailRow label="Driver resources">
            <span className="font-mono text-[13px] text-muted-foreground">{resourceSummary(cfg.driver)}</span>
          </DetailRow>
          <DetailRow label="Executor resources">
            <span className="font-mono text-[13px] text-muted-foreground">{resourceSummary(cfg.executor)}</span>
          </DetailRow>
          {cfg.idle_minutes > 0 && <DetailRow label="Auto-terminate">{cfg.idle_minutes} min idle</DetailRow>}
          {cfg.image && (
            <DetailRow label="Image">
              <span className="break-all font-mono text-[13px] text-muted-foreground">{cfg.image}</span>
            </DetailRow>
          )}
        </>
      )}
      <DetailRow label="Connect">
        <div className="flex items-center gap-2">
          <code className="flex-1 truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[13px] text-foreground">{url}</code>
          <Button variant="ghost" onClick={onConnect} aria-label="Copy connect URL">
            <Copy className="h-4 w-4" />
          </Button>
        </div>
      </DetailRow>
    </div>
  );
}

function EventsTab({ clusterId }: { clusterId: string }) {
  const [events, setEvents] = useState<ClusterEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setEvents(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/clusters/${clusterId}/events`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setError(await readError(res));
          return;
        }
        const body = await res.json();
        if (!cancelled) setEvents(body.events ?? []);
      } catch {
        if (!cancelled) setError("Could not reach the API.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  if (error) return <p className="py-6 text-center text-sm text-error">{error}</p>;
  if (events === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading events…</p>;
  if (events.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">No events reported for this cluster.</p>;

  return (
    <div className="-mx-1 overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>Type</Th>
            <Th>Reason</Th>
            <Th>Message</Th>
            <Th className="text-right">Count</Th>
          </Tr>
        </Thead>
        <Tbody>
          {events.map((e, i) => (
            <Tr key={i}>
              <Td className="whitespace-nowrap">
                <Badge kind={e.type?.toLowerCase() === "warning" ? "failed" : "running"}>{e.type || "—"}</Badge>
              </Td>
              <Td className="whitespace-nowrap font-medium text-foreground">{e.reason}</Td>
              <Td className="text-muted-foreground">{e.message}</Td>
              <Td className="text-right tabular-nums text-muted-foreground">{e.count}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

function MetricsTab({ clusterId }: { clusterId: string }) {
  const [metrics, setMetrics] = useState<ClusterMetrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setMetrics(null);
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/clusters/${clusterId}/metrics`, { cache: "no-store" });
        if (cancelled) return;
        if (!res.ok) {
          setError(await readError(res));
          return;
        }
        const body = (await res.json()) as ClusterMetrics;
        if (!cancelled) setMetrics(body);
      } catch {
        if (!cancelled) setError("Could not reach the API.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clusterId]);

  if (error) return <p className="py-6 text-center text-sm text-error">{error}</p>;
  if (metrics === null) return <p className="py-6 text-center text-sm text-muted-foreground">Loading metrics…</p>;

  if (!metrics.available) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
        <p className="mb-1 text-sm font-semibold text-foreground">Metrics unavailable</p>
        <p className="text-sm text-muted-foreground">
          The cluster&apos;s metrics-server is not installed, so live CPU and memory usage can&apos;t be shown.
        </p>
      </div>
    );
  }

  const pods = metrics.pods ?? [];
  if (pods.length === 0)
    return <p className="py-6 text-center text-sm text-muted-foreground">No pod metrics reported yet.</p>;

  return (
    <div className="-mx-1 overflow-x-auto">
      <Table>
        <Thead>
          <Tr>
            <Th>Pod</Th>
            <Th className="text-right">CPU</Th>
            <Th className="text-right">Memory</Th>
          </Tr>
        </Thead>
        <Tbody>
          {pods.map((p) => (
            <Tr key={p.name}>
              <Td className="font-mono text-[13px] text-foreground">{p.name}</Td>
              <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">{p.cpu}</Td>
              <Td className="text-right font-mono text-[13px] tabular-nums text-muted-foreground">{p.memory}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

// Cluster permission levels (Phase 4e contract): attach lets a principal attach
// notebooks/sessions; manage additionally administers the cluster + its grants.
const CLUSTER_LEVELS = ["attach", "manage"];

function PermissionsTab({ clusterId }: { clusterId: string }) {
  return <PermissionsEditor kind="clusters" objectId={clusterId} levels={CLUSTER_LEVELS} />;
}
