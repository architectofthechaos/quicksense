"use client";
import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";
import type { Permission, PrincipalType } from "@/lib/types";
import type { PermissionKind } from "@/lib/api";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";

async function readError(res: Response): Promise<string> {
  try {
    const b = await res.json();
    return b?.error?.message ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

// PermissionsEditor — reusable object-level access editor for the Phase 4e
// permissions tabs (clusters + notebooks). It lists current grants, adds a grant
// (principal type + id + level), and revokes. All calls route through the BFF
// (`/api/{kind}/{objectId}/permissions`); the catch-all proxies notebooks, the
// dedicated route proxies clusters. The `levels` prop is the source of truth for
// which levels this object kind supports (cluster: attach,manage; notebook:
// view,run,edit,manage), so the same component serves both contracts.
export function PermissionsEditor({
  kind,
  objectId,
  levels,
}: {
  kind: PermissionKind;
  objectId: string;
  levels: string[];
}) {
  const { toast } = useToast();
  const [perms, setPerms] = useState<Permission[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [principalType, setPrincipalType] = useState<PrincipalType>("user");
  const [principalId, setPrincipalId] = useState("");
  const [level, setLevel] = useState<string>(levels[0] ?? "");

  const base = `/api/${kind}/${encodeURIComponent(objectId)}/permissions`;

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(base, { cache: "no-store" });
      if (!res.ok) {
        setError(await readError(res));
        setPerms([]);
        return;
      }
      setPerms(((await res.json()).permissions ?? []) as Permission[]);
    } catch {
      setError("Could not reach the API.");
      setPerms([]);
    }
  }, [base]);

  useEffect(() => {
    setPerms(null);
    void load();
  }, [load]);

  // Keep the level select valid if the levels prop changes (e.g. kind switch).
  useEffect(() => {
    if (!levels.includes(level)) setLevel(levels[0] ?? "");
  }, [levels, level]);

  async function grant() {
    const pid = principalId.trim();
    if (!pid || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ principal_type: principalType, principal_id: pid, level }),
      });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      setPrincipalId("");
      toast(`Granted ${level} to ${pid}`);
      await load();
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(p: Permission) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const qs = `principal_type=${encodeURIComponent(p.principal_type)}&principal_id=${encodeURIComponent(p.principal_id)}`;
      const res = await fetch(`${base}?${qs}`, { method: "DELETE" });
      if (!res.ok && res.status !== 204) {
        setError(await readError(res));
        return;
      }
      toast(`Revoked access for ${p.principal_id}`);
      await load();
    } catch {
      setError("Could not reach the API.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {/* Add-grant form */}
      <div className="rounded-lg border border-border bg-surface-2 p-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground">Grant access</p>
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
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void grant();
              }
            }}
            placeholder={principalType === "user" ? "username" : "group name"}
            className="focus-ring min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-faint"
          />
          <select
            aria-label="Permission level"
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            className="focus-ring rounded-lg border border-border bg-background px-2.5 py-2 text-sm capitalize text-foreground"
          >
            {levels.map((l) => (
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

      {error && (
        <p role="alert" className="text-sm text-error">
          {error}
        </p>
      )}

      {/* Current grants */}
      {perms === null ? (
        <p className="py-6 text-center text-sm text-muted-foreground">Loading permissions…</p>
      ) : perms.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center">
          <p className="mb-1 text-sm font-semibold text-foreground">No grants yet</p>
          <p className="text-sm text-muted-foreground">Grant a user or group access using the form above.</p>
        </div>
      ) : (
        <div className="-mx-1 overflow-x-auto rounded-lg border border-border">
          <Table>
            <Thead>
              <Tr>
                <Th>Principal</Th>
                <Th>Type</Th>
                <Th>Level</Th>
                <Th className="text-right">Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {perms.map((p) => (
                <Tr key={`${p.principal_type}:${p.principal_id}`}>
                  <Td className="font-medium text-foreground">{p.principal_id}</Td>
                  <Td className="text-muted-foreground">{p.principal_type}</Td>
                  <Td>
                    <Badge kind="unknown">{p.level}</Badge>
                  </Td>
                  <Td className="text-right">
                    <button
                      type="button"
                      onClick={() => void revoke(p)}
                      disabled={busy}
                      aria-label={`Revoke access for ${p.principal_id}`}
                      className="focus-ring rounded-md p-1 text-muted-foreground transition-colors hover:bg-[color-mix(in_srgb,var(--error)_10%,var(--surface))] hover:text-error disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </div>
      )}
    </div>
  );
}
