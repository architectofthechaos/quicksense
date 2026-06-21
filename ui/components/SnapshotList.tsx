import type { TableSnapshot } from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";
import { Badge } from "@/components/ui/Badge";

// formatTs renders an epoch-millis snapshot timestamp as a compact, locale-
// stable UTC string. Falls back to the raw value if unparseable.
function formatTs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "—";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "—";
  // YYYY-MM-DD HH:MM:SS UTC — deterministic across locales/timezones.
  return `${d.toISOString().slice(0, 19).replace("T", " ")} UTC`;
}

// Iceberg snapshot history, newest first. The snapshot matching
// currentSnapshotId is badged "Current".
export function SnapshotList({
  snapshots,
  currentSnapshotId,
}: {
  snapshots: TableSnapshot[];
  currentSnapshotId: string;
}) {
  if (snapshots.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No history for this table.
      </div>
    );
  }
  // Sort a copy newest-first so we never mutate the prop.
  const ordered = [...snapshots].sort((a, b) => b.timestamp_ms - a.timestamp_ms);
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <Thead>
          <Tr>
            <Th>Snapshot ID</Th>
            <Th>Timestamp</Th>
            <Th>Operation</Th>
            <Th />
          </Tr>
        </Thead>
        <Tbody>
          {ordered.map((s) => {
            const current = s.snapshot_id === currentSnapshotId;
            return (
              <Tr key={s.snapshot_id}>
                <Td className="whitespace-nowrap font-mono text-[12px] text-foreground">{s.snapshot_id}</Td>
                <Td className="whitespace-nowrap font-mono text-[12px] tabular-nums text-muted-foreground">
                  {formatTs(s.timestamp_ms)}
                </Td>
                <Td className="whitespace-nowrap text-muted-foreground">{s.operation || "—"}</Td>
                <Td className="whitespace-nowrap text-right">
                  {current && <Badge kind="ready">Current</Badge>}
                </Td>
              </Tr>
            );
          })}
        </Tbody>
      </Table>
    </div>
  );
}
