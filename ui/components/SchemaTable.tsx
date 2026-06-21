import type { TableColumn } from "@/lib/types";
import { Table, Thead, Tbody, Tr, Th, Td } from "@/components/ui/Table";

// Iceberg schema rendered as a name / type / nullable / comment grid. An Iceberg
// `required` field is the inverse of SQL nullability, so we present "Nullable".
export function SchemaTable({ columns }: { columns: TableColumn[] }) {
  if (columns.length === 0) {
    return <EmptyHint>No columns in this table&apos;s schema.</EmptyHint>;
  }
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <Table>
        <Thead>
          <Tr>
            <Th>Column</Th>
            <Th>Type</Th>
            <Th>Nullable</Th>
            <Th>Comment</Th>
          </Tr>
        </Thead>
        <Tbody>
          {columns.map((c) => (
            <Tr key={c.name}>
              <Td className="whitespace-nowrap font-mono text-[13px] font-medium text-foreground">{c.name}</Td>
              <Td className="whitespace-nowrap font-mono text-[13px] text-muted-foreground">{c.type}</Td>
              <Td className="whitespace-nowrap text-muted-foreground">{c.required ? "No" : "Yes"}</Td>
              <Td className="text-muted-foreground">{c.doc || <span className="text-faint">—</span>}</Td>
            </Tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface p-8 text-center text-sm text-muted-foreground">
      {children}
    </div>
  );
}
