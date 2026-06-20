import { Mark } from "@/components/brand/Logo";

export default function CatalogPage() {
  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-[-0.02em] text-foreground">Catalog</h1>
        <p className="mt-1 text-sm text-muted-foreground">Browse Iceberg catalogs and tables (read-only).</p>
      </div>
      <div className="rounded-xl border border-dashed border-border bg-surface p-14 text-center shadow-card">
        <Mark className="mx-auto mb-4 h-12 w-12 opacity-40" />
        <p className="mb-1 text-base font-semibold text-foreground">Catalog browser coming soon</p>
        <p className="text-sm text-muted-foreground">Read-only Iceberg catalog & table browsing arrives in a later sprint.</p>
      </div>
    </section>
  );
}
