export default function CatalogPage() {
  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Catalog</h1>
        <p className="mt-1 text-sm text-slate-500">Browse Iceberg catalogs and tables (read-only).</p>
      </div>
      <div className="rounded-xl border border-dashed border-surface-border bg-surface p-12 text-center">
        <div
          className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-accent-muted font-mono text-accent"
          aria-hidden
        >
          ☰
        </div>
        <p className="mb-1 font-medium text-slate-800">Read-only catalog browser</p>
        <p className="text-sm text-slate-500">Coming in a later sprint.</p>
      </div>
    </section>
  );
}
