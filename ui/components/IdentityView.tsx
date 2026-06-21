"use client";
import { useCallback, useEffect, useState } from "react";
import { Plus, Users, UsersRound, ShieldCheck, ShieldAlert, ServerCog } from "lucide-react";
import type { KcUser, KcGroup } from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Dialog } from "@/components/ui/Dialog";
import { useToast } from "@/components/ui/Toast";

// Realm roles a user can be assigned. quicksense_admin is the gate for this very
// screen; viewer/editor are the standard non-admin roles. The Go API is the
// source of truth and rejects an unknown role — this list just seeds the select.
const ASSIGNABLE_ROLES = ["viewer", "editor", "quicksense_admin"];

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// LoadState models a section's fetch lifecycle. 403 (caller lacks the
// quicksense_admin role) and 501 (Keycloak admin unconfigured) are first-class
// terminal states distinct from a generic error so the UI can explain each.
type LoadState<T> =
  | { kind: "loading" }
  | { kind: "ready"; data: T }
  | { kind: "forbidden" }
  | { kind: "unconfigured" }
  | { kind: "error"; message: string };

// classify maps a failed Response to the matching terminal LoadState. 403 and 501
// get dedicated states; everything else is a generic error carrying the message.
async function classify(res: Response): Promise<LoadState<never>> {
  if (res.status === 403) return { kind: "forbidden" };
  if (res.status === 501) return { kind: "unconfigured" };
  return { kind: "error", message: await readError(res) };
}

export function IdentityView() {
  const [users, setUsers] = useState<LoadState<KcUser[]>>({ kind: "loading" });
  const [groups, setGroups] = useState<LoadState<KcGroup[]>>({ kind: "loading" });

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/users", { cache: "no-store" });
      if (!res.ok) {
        setUsers(await classify(res));
        return;
      }
      setUsers({ kind: "ready", data: ((await res.json()).users ?? []) as KcUser[] });
    } catch {
      setUsers({ kind: "error", message: "Could not reach the API." });
    }
  }, []);

  const loadGroups = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/groups", { cache: "no-store" });
      if (!res.ok) {
        setGroups(await classify(res));
        return;
      }
      setGroups({ kind: "ready", data: ((await res.json()).groups ?? []) as KcGroup[] });
    } catch {
      setGroups({ kind: "error", message: "Could not reach the API." });
    }
  }, []);

  useEffect(() => {
    void loadUsers();
    void loadGroups();
  }, [loadUsers, loadGroups]);

  // Both sections share the same quicksense_admin gate and Keycloak config, so a
  // 403/501 is a property of the whole screen — surface it once as a full-page
  // takeover rather than twice per section. The users probe drives this (it loads
  // alongside groups); inline per-section errors cover everything else.
  if (users.kind === "forbidden") return <Gate variant="forbidden" />;
  if (users.kind === "unconfigured") return <Gate variant="unconfigured" />;

  return (
    <section className="mx-auto max-w-[1100px] space-y-10">
      <header>
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Identity &amp; Access</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage Keycloak realm users and groups, and assign realm roles. Requires the{" "}
          <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">quicksense_admin</code>{" "}
          role.
        </p>
      </header>

      <UsersSection state={users} reload={loadUsers} />
      <GroupsSection state={groups} reload={loadGroups} />
    </section>
  );
}

// ── Full-page gate (403 / 501) ───────────────────────────────────────────────

function Gate({ variant }: { variant: "forbidden" | "unconfigured" }) {
  const forbidden = variant === "forbidden";
  const Icon = forbidden ? ShieldAlert : ServerCog;
  return (
    <section className="mx-auto max-w-[1100px]">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Identity &amp; Access</h1>
      </header>
      <div
        role="alert"
        className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-surface p-14 text-center shadow-card"
      >
        <Icon className="mb-4 h-12 w-12 text-faint" strokeWidth={1.5} />
        {forbidden ? (
          <>
            <p className="mb-1 text-base font-semibold text-foreground">
              Identity &amp; Access requires the quicksense_admin role
            </p>
            <p className="max-w-md text-sm text-muted-foreground">
              Your account doesn&apos;t have the{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground">quicksense_admin</code>{" "}
              realm role. Ask an administrator to grant it to manage users and groups.
            </p>
          </>
        ) : (
          <>
            <p className="mb-1 text-base font-semibold text-foreground">Keycloak admin is not configured</p>
            <p className="max-w-md text-sm text-muted-foreground">
              This environment has no Keycloak admin connection, so users and groups can&apos;t be managed here. Configure
              the Keycloak admin credentials on the control-plane API to enable this screen.
            </p>
          </>
        )}
      </div>
    </section>
  );
}

// ── Shared section chrome ────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  action,
}: {
  icon: typeof Users;
  title: string;
  subtitle: string;
  action: React.ReactNode;
}) {
  return (
    <div className="mb-4 flex items-end justify-between gap-3">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold text-foreground">
          <Icon className="h-5 w-5 text-primary" strokeWidth={2} /> {title}
        </h2>
        <p className="mt-0.5 text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {action}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border px-4 py-2.5 text-sm"
      style={{
        color: "var(--error)",
        borderColor: "color-mix(in srgb, var(--error) 30%, var(--border))",
        background: "color-mix(in srgb, var(--error) 8%, var(--surface))",
      }}
    >
      {message}
    </div>
  );
}

function LoadingCard({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-border bg-surface p-10 text-center text-sm text-muted-foreground shadow-card">
      {label}
    </div>
  );
}

function EmptyCard({ icon: Icon, title, subtitle }: { icon: typeof Users; title: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center shadow-card">
      <Icon className="mx-auto mb-3 h-10 w-10 text-faint" strokeWidth={1.5} />
      <p className="mb-1 text-base font-semibold text-foreground">{title}</p>
      <p className="text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

// ── Users section ────────────────────────────────────────────────────────────

function UsersSection({ state, reload }: { state: LoadState<KcUser[]>; reload: () => Promise<void> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createUser(username: string, email: string): Promise<string | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, email }),
      });
      if (!res.ok) return await readError(res);
      setOpen(false);
      toast(`User ${username} created`);
      await reload();
      return null;
    } catch {
      return "Could not reach the API.";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader
        icon={Users}
        title="Users"
        subtitle="Realm users who can sign in to QuickSense."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add user
          </Button>
        }
      />

      {state.kind === "error" && <ErrorBanner message={state.message} />}

      {state.kind === "loading" ? (
        <LoadingCard label="Loading users…" />
      ) : state.kind === "ready" ? (
        state.data.length === 0 ? (
          <EmptyCard icon={Users} title="No users yet" subtitle="Add your first realm user to grant access." />
        ) : (
          <UsersTable users={state.data} reload={reload} />
        )
      ) : null}

      <AddUserDialog open={open} busy={busy} onClose={() => setOpen(false)} onSubmit={createUser} />
    </div>
  );
}

function UsersTable({ users, reload }: { users: KcUser[]; reload: () => Promise<void> }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <Table aria-label="Users">
        <Thead>
          <Tr>
            <Th>Username</Th>
            <Th>Email</Th>
            <Th>Status</Th>
            <Th className="text-right">Assign role</Th>
          </Tr>
        </Thead>
        <Tbody>
          {users.map((u) => (
            <UserRow key={u.id} user={u} reload={reload} />
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

function UserRow({ user, reload }: { user: KcUser; reload: () => Promise<void> }) {
  const { toast } = useToast();
  const [role, setRole] = useState<string>(ASSIGNABLE_ROLES[0]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function assign() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(user.id)}/roles`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      toast(`Assigned ${role} to ${user.username}`);
      await reload();
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Tr>
      <Td className="whitespace-nowrap font-medium text-foreground">{user.username}</Td>
      <Td className="text-muted-foreground">{user.email || "—"}</Td>
      <Td>
        <Badge kind={user.enabled ? "ready" : "unknown"}>{user.enabled ? "Enabled" : "Disabled"}</Badge>
      </Td>
      <Td className="text-right">
        <div className="flex items-center justify-end gap-2">
          {error && <span className="text-xs text-error">{error}</span>}
          <select
            aria-label={`Role for ${user.username}`}
            value={role}
            onChange={(e) => setRole(e.target.value)}
            disabled={busy}
            className="focus-ring rounded-lg border border-border bg-background px-2.5 py-1.5 text-sm text-foreground disabled:opacity-50"
          >
            {ASSIGNABLE_ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button
            variant="secondary"
            onClick={() => void assign()}
            disabled={busy}
            aria-label={`Assign role to ${user.username}`}
          >
            <ShieldCheck className="h-4 w-4" /> Assign
          </Button>
        </div>
      </Td>
    </Tr>
  );
}

function AddUserDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (username: string, email: string) => Promise<string | null>;
}) {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog opens so a prior draft doesn't leak.
  useEffect(() => {
    if (open) {
      setUsername("");
      setEmail("");
      setError(null);
    }
  }, [open]);

  const valid = username.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    const err = await onSubmit(username.trim(), email.trim());
    setError(err);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add user">
      <p className="mb-5 mt-1 text-sm text-muted-foreground">
        Create a new Keycloak realm user. They can sign in once created.
      </p>

      <div className="space-y-4">
        <div>
          <FieldLabel htmlFor="u-username">Username</FieldLabel>
          <input
            id="u-username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="alice"
            autoFocus
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
        </div>
        <div>
          <FieldLabel htmlFor="u-email">Email</FieldLabel>
          <input
            id="u-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void submit()}
            placeholder="alice@example.com"
            className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !valid}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Groups section ───────────────────────────────────────────────────────────

function GroupsSection({ state, reload }: { state: LoadState<KcGroup[]>; reload: () => Promise<void> }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function createGroup(name: string): Promise<string | null> {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) return await readError(res);
      setOpen(false);
      toast(`Group ${name} created`);
      await reload();
      return null;
    } catch {
      return "Could not reach the API.";
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <SectionHeader
        icon={UsersRound}
        title="Groups"
        subtitle="Group principals for object-level access grants."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> Add group
          </Button>
        }
      />

      {state.kind === "error" && <ErrorBanner message={state.message} />}
      {/* Groups inherits the same admin gate as users; the full-page takeover in
          IdentityView fires off the users probe, so a forbidden/unconfigured
          groups state here is only reachable transiently — render nothing for it. */}

      {state.kind === "loading" ? (
        <LoadingCard label="Loading groups…" />
      ) : state.kind === "ready" ? (
        state.data.length === 0 ? (
          <EmptyCard icon={UsersRound} title="No groups yet" subtitle="Create a group to organize access grants." />
        ) : (
          <GroupsTable groups={state.data} />
        )
      ) : null}

      <AddGroupDialog open={open} busy={busy} onClose={() => setOpen(false)} onSubmit={createGroup} />
    </div>
  );
}

function GroupsTable({ groups }: { groups: KcGroup[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-card">
      <Table aria-label="Groups">
        <Thead>
          <Tr>
            <Th>Name</Th>
            <Th>ID</Th>
          </Tr>
        </Thead>
        <Tbody>
          {groups.map((g) => (
            <Tr key={g.id}>
              <Td className="whitespace-nowrap font-medium text-foreground">{g.name}</Td>
              <Td className="font-mono text-[12px] text-muted-foreground">{g.id}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

function AddGroupDialog({
  open,
  busy,
  onClose,
  onSubmit,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (name: string) => Promise<string | null>;
}) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setError(null);
    }
  }, [open]);

  const valid = name.trim().length > 0;

  async function submit() {
    if (!valid || busy) return;
    const err = await onSubmit(name.trim());
    setError(err);
  }

  return (
    <Dialog open={open} onClose={onClose} title="Add group">
      <p className="mb-5 mt-1 text-sm text-muted-foreground">Create a new Keycloak realm group.</p>

      <div>
        <FieldLabel htmlFor="g-name">Group name</FieldLabel>
        <input
          id="g-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void submit()}
          placeholder="data-engineering"
          autoFocus
          className="focus-ring w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
        />
      </div>

      {error && (
        <p role="alert" className="mt-4 text-sm text-error">
          {error}
        </p>
      )}

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !valid}>
          {busy ? "Creating…" : "Create"}
        </Button>
      </div>
    </Dialog>
  );
}

// ── Shared form bits ─────────────────────────────────────────────────────────

function FieldLabel({ htmlFor, children }: { htmlFor?: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="mb-1.5 block text-xs font-medium text-muted-foreground">
      {children}
    </label>
  );
}
