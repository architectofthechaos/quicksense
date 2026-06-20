import type { HTMLAttributes, TableHTMLAttributes } from "react";

export const Table = (p: TableHTMLAttributes<HTMLTableElement>) => (
  <table className="w-full border-collapse text-left text-sm" {...p} />
);
export const Thead = (p: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className="border-b border-border bg-muted text-[11px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
    {...p}
  />
);
export const Tbody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const Tr = (p: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className="border-b border-border transition-colors last:border-0" {...p} />
);
export const Th = (p: HTMLAttributes<HTMLTableCellElement>) => (
  <th className="px-4 py-2.5 text-left font-semibold" {...p} />
);
export const Td = (p: HTMLAttributes<HTMLTableCellElement>) => (
  <td className="px-4 py-3.5 align-middle" {...p} />
);
