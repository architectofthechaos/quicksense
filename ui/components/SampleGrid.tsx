import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";

// formatCell renders an arbitrary Trino-sampled value as display text. null /
// undefined become a dim "NULL"; objects/arrays are JSON-stringified; everything
// else is coerced to a string.
function formatCell(v: unknown): { text: string; isNull: boolean } {
  if (v === null || v === undefined) return { text: "NULL", isNull: true };
  if (typeof v === "object") {
    try {
      return { text: JSON.stringify(v), isNull: false };
    } catch {
      return { text: String(v), isNull: false };
    }
  }
  return { text: String(v), isNull: false };
}

// Top-N sample rows in a dense monospace grid. Presentational only — callers
// own loading / error / "sample unavailable" states.
export function SampleGrid({ columns, rows }: { columns: string[]; rows: unknown[][] }) {
  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
        No rows returned for this sample.
      </div>
    );
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <Thead>
          <Tr>
            {columns.map((c) => (
              <Th key={c} className="whitespace-nowrap font-mono text-[11px]">
                {c}
              </Th>
            ))}
          </Tr>
        </Thead>
        <Tbody>
          {rows.map((row, ri) => (
            <Tr key={ri}>
              {row.map((cell, ci) => {
                const { text, isNull } = formatCell(cell);
                return (
                  <Td
                    key={ci}
                    className={`max-w-[28rem] truncate whitespace-nowrap py-2.5 font-mono text-[12px] tabular-nums ${
                      isNull ? "text-faint italic" : "text-foreground"
                    }`}
                    title={text}
                  >
                    {text}
                  </Td>
                );
              })}
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}
