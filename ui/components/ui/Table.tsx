import type { HTMLAttributes, TableHTMLAttributes } from "react";

export const Table = (p: TableHTMLAttributes<HTMLTableElement>) => (
  <table className="w-full border-collapse text-left text-sm" {...p} />
);
export const Thead = (p: HTMLAttributes<HTMLTableSectionElement>) => (
  <thead
    className="border-b border-surface-border bg-surface-subtle text-[11px] font-medium uppercase tracking-wider text-slate-500"
    {...p}
  />
);
export const Tbody = (p: HTMLAttributes<HTMLTableSectionElement>) => <tbody {...p} />;
export const Tr = (p: HTMLAttributes<HTMLTableRowElement>) => (
  <tr className="border-b border-surface-border transition-colors last:border-0 hover:bg-surface-subtle/60" {...p} />
);
export const Th = (p: HTMLAttributes<HTMLTableCellElement>) => <th className="px-4 py-2.5 font-medium" {...p} />;
export const Td = (p: HTMLAttributes<HTMLTableCellElement>) => <td className="px-4 py-3 align-middle" {...p} />;
