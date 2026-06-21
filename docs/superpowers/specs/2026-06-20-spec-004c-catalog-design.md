# SPEC-004c Design — Catalog Browser (real)

Parent: program design. Replace the catalog stub with a working Iceberg/Polaris browser. **Read-first** (D10); create-namespace/table only if time.

## Polaris client additions (`api/internal/polaris/client.go`)
- `ListNamespaces(ctx, catalog) ([]Namespace, error)` — Iceberg REST `GET /api/catalog/v1/{catalog}/namespaces` (handle nested).
- `LoadTable(ctx, catalog, ns, table) (*TableMetadata, error)` — Iceberg REST `GET …/tables/{t}`; parse `metadata`: `schema` (fields: id, name, type, required, doc), `partition-spec`, `properties`, `location`, `current-snapshot-id`, `snapshots` (snapshot-id, timestamp-ms, summary.operation).
- (Optional) `CreateNamespace`.

## Trino client (`api/internal/trino` — new)
Minimal HTTP client to Trino (`http://trino:8080`, user = real principal in 4e, service user now): `Sample(ctx, catalog, ns, table, limit) (columns []string, rows [][]any, error)` issuing `SELECT * FROM iceberg.{ns}.{table} LIMIT {n}` and following Trino's `nextUri` paging until results. Catalog name maps Polaris `quicksense` → Trino `iceberg` catalog (configurable).

## Endpoints (`api/internal/http`)
- `GET /v1/catalogs` — exists.
- `GET /v1/catalogs/{c}/namespaces` — list namespaces.
- `GET /v1/catalogs/{c}/namespaces/{ns}/tables` — exists.
- `GET /v1/catalogs/{c}/namespaces/{ns}/tables/{t}` — `{columns, details, history}` from `LoadTable`.
- `GET /v1/catalogs/{c}/namespaces/{ns}/tables/{t}/sample?limit=N` — `{columns, rows}` via Trino.

## UI (`ui/app/app/catalog`)
- **Layout:** left `Tree` (catalogs → namespaces → tables, lazy-expand) + right detail (`Tabs`).
- **Tabs:** Columns (`SchemaTable`: name/type/nullable/comment) · Sample (`DataGrid`, monospace, top-N via Trino) · Details (location/format/current snapshot/partition spec/properties) · History (`SnapshotTimeline`: id/timestamp/operation) · Permissions (shown; functional in 4e).
- `lib/api.ts`: `listNamespaces`, `getTable`, `getTableSample`; Next route handlers each.

## Tests
- Go: Polaris `ListNamespaces`/`LoadTable` parsing (httptest fixtures of real Iceberg REST payloads); Trino `Sample` (httptest mimicking Trino's `nextUri` protocol); endpoint tests with fakes.
- UI: tree expand/select; tab rendering; sample grid; empty/error states.

## DoD
Browse `quicksense` → `demo` → `events` in the UI. Detail shows columns, sample (via Trino), details, Iceberg history. All reads via the Go API (UI never calls Polaris/Trino directly). Tests for API + UI.
