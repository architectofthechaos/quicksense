# SPEC-004 Program Design — Core Product

- **Status:** Approved-by-delegation (owner unavailable; autonomous implementation authorized 2026-06-20)
- **Branch:** `implement-spec-004-tdd` (cut from `origin/main` @ `c94b7df`, which carries the SPEC-003 UI)
- **Method:** TDD, phase-by-phase (4a → 4e), each phase an independently-reviewable unit
- **Source spec:** `SPEC-004-sprint4-core-product.md`
- **Last updated:** 2026-06-20

This is the program-level design. Each phase has its own design doc (`2026-06-20-spec-004{a..e}-*-design.md`) with the concrete API surface, components, data-model deltas, test plan, and DoD mapping.

---

## 1. Decisions log (locked)

| # | Decision | Choice & rationale |
|---|----------|--------------------|
| D1 | Base branch | UI already on `origin/main` (`c94b7df`); branched SPEC-004 from it; fast-forwarded local `main`. |
| D2 | UI direction | **Evolve** the indigo CSS-variable token system into a **full-width enterprise console**. The token architecture (light/dark, self-hosted Inter/JetBrains Mono, air-gapped) is sound and matches the branded login; a rebrand would create drift. Elevate layout density, component depth, and state craft instead. |
| D3 | Shell layout | Replace the `max-w-5xl` centered content with a **full-width fluid layout**: persistent left nav, full-viewport content, contextual right detail panels. Add breadcrumbs. |
| D4 | Streaming transport | **SSE** for driver logs (4b) and notebook cell output (4d). Go API emits an event stream; the Next route handler proxies; the browser consumes via `EventSource`/`ReadableStream`. Simple, air-gapped, no extra infra. |
| D5 | Notebook execution (4d) | **Python Spark-Connect broker** using `pyspark[connect]` (already in the Spark image, commit `d700697`). The Go API brokers per-`(user, notebook, cluster)` sessions to it and relays output. Go has no first-class Spark Connect (gRPC+Arrow) client; reimplementing it would dwarf the rest of 4d. |
| D6 | Code editor | **CodeMirror 6** (npm-bundled). Monaco's default loader pulls from a CDN — incompatible with air-gapped-first. CodeMirror 6 bundles cleanly and is lighter. |
| D7 | Per-user identity (4e) | **Brokered per-user Keycloak tokens.** The API attributes Polaris/Trino reads and Spark execution to the real logged-in user (Polaris external OIDC already maps by `preferred_username`). RFC 8693 token-exchange is documented as the upgrade path, not built now. |
| D8 | AuthZ enforcement (4e) | Server-side in the Go API via a single `authorize(ctx, principal, objectType, objectID, level)` gate backed by a Postgres `permissions` table. UI reflection is cosmetic. |
| D9 | Identity store | Users/groups live in **Keycloak**, managed via the **Admin API** (client-credentials admin client). The API's `permissions` table references Keycloak principal IDs; we do not duplicate the user directory. |
| D10 | Catalog scope (4c) | **Read-first.** Browse + table detail (columns/sample/details/history). Create-namespace/table added only if time allows. |
| D11 | Notebook split (4d) | **4d-1** = file tree + cell editor + attach + execute + output. **4d-2** = save/versions/restore + share/permissions + export. |

---

## 2. Design system & UX direction

**Keep:** the token system in [ui/app/globals.css](../../../ui/app/globals.css) + [ui/tailwind.config.ts](../../../ui/tailwind.config.ts) (indigo, light/dark, self-hosted fonts), the `badge`/`focus-ring` utilities, and the existing primitives (`Badge`, `Button`, `Dialog`, `Drawer`, `Table`, `Toast`).

**Add — the enterprise console layer:**
- **Shell:** full-width app frame; left nav with sectioned groups (Compute, Data, Workspace, Admin); top bar with breadcrumbs + global actions + user menu; contextual right-hand detail panels (vs. the current modal-only drawer).
- **Component library (new):** `DataTable` (sortable, filterable, sticky header, resizable cols, row selection, dense mode), `Tree` (lazy-expand, keyboard nav), `Tabs`, `KeyValueEditor`, `ResourceField` (cpu/mem with units), `LogViewer` (live SSE, follow-tail, wrap toggle), `CodeEditor` (CodeMirror 6), `OutputRenderer` (text / table / error traceback), `PermissionsEditor`, `Breadcrumbs`, `EmptyState`, `Skeleton`.
- **State craft:** every data surface has explicit empty / loading (skeleton) / error / partial states; keyboard affordances; consistent focus treatment; respects `prefers-reduced-motion` (already wired).
- **Process:** UI built under the **frontend-design** skill for visual quality; a layout mockup is produced before the first heavy screen (4b).

Tokens may gain a few additions (e.g. a denser spacing scale, table row tints, a `--info` color), kept in `globals.css` — no ad-hoc inline styling.

---

## 3. Cross-cutting architecture

```
Browser (React client components)
  │  fetch('/api/…')                         ← no secrets, no data-plane access
  ▼
Next.js route handlers  (ui/app/api/**)      ← BFF: reads Auth.js session, injects Bearer
  │  apiFetch(path, token)  (ui/lib/api.ts)
  ▼
Go control-plane API  (api/, chi)            ← authZ gate, brokers everything
  ├─► Polaris  (catalog metadata, grants)
  ├─► Trino    (sample-data SELECTs)
  ├─► Spark Connect broker (cell execution)
  ├─► Kubernetes (SparkConnect CRs, pod logs/events)
  └─► Keycloak Admin API (users/groups)
```

**Every feature is the same four-layer slice:** Go endpoint → `ui/lib/api.ts` typed fn → Next route handler under `ui/app/api/…` → UI components. This keeps the BFF invariant (browser never holds Polaris/Spark/Trino/admin creds) and makes each slice testable at every layer.

**Auth context:** the Go API already validates the Keycloak JWT and has the principal (`preferred_username`, realm roles) in request context via `auth.RequireAuth`. 4e extends this into the `authorize` gate; per-user identity (D7) reuses the same token.

---

## 4. Data model evolution (Postgres, golang-migrate)

Existing: `workspaces`, `clusters` (minimal). New migrations (one per phase that needs it):

- **0002 (4b) — clusters config:** add `worker_min int`, `worker_max int`, `driver_cpu/driver_mem/executor_cpu/executor_mem` (request+limit) `text`, `image text`, `idle_minutes int`, `pinned bool`, `spark_conf jsonb`, `env jsonb`, `tags jsonb`, `desired_state text` (Running/Stopped), `last_activity_at timestamptz`.
- **0003 (4d) — notebooks:** `folders(id, parent_id, name, path, trashed_at)`, `notebooks(id, folder_id, name, path, owner, content jsonb /* cells */, attached_cluster_id, trashed_at, created_at, updated_at)`, `notebook_revisions(id, notebook_id, snapshot jsonb, message, author, created_at)`.
- **0004 (4e) — permissions:** `permissions(id, object_type text, object_id text, principal_type text /* user|group */, principal_id text, level text, granted_by, created_at, UNIQUE(object_type,object_id,principal_type,principal_id))`.

Cell content is stored as JSONB on the notebook (cells = `[{id, type: code|markdown, source, outputs}]`); revisions snapshot the whole notebook.

---

## 5. API surface (new across all phases)

| Phase | Method & path | Purpose |
|---|---|---|
| 4b | `POST /v1/clusters` (extended body) | Full pod resources + config |
| 4b | `PATCH /v1/clusters/{id}` | Pin / edit config |
| 4b | `POST /v1/clusters/{id}/start\|stop\|restart\|clone` | Lifecycle |
| 4b | `GET /v1/clusters/{id}/events` | CR/pod events |
| 4b | `GET /v1/clusters/{id}/logs?container=driver` | Driver logs (SSE) |
| 4b | `GET /v1/clusters/{id}/metrics` | Best-effort CPU/mem |
| 4c | `GET /v1/catalogs/{c}/namespaces` | List namespaces |
| 4c | `GET /v1/catalogs/{c}/namespaces/{ns}/tables/{t}` | Table detail (schema/details/history) |
| 4c | `GET /v1/catalogs/{c}/namespaces/{ns}/tables/{t}/sample?limit=N` | Sample rows (via Trino) |
| 4d | `GET/POST /v1/notebooks`, `GET/PUT/DELETE /v1/notebooks/{id}` | Notebook CRUD |
| 4d | `GET /v1/notebooks/tree`, folder ops, move/rename/trash | Workspace tree |
| 4d | `POST /v1/notebooks/{id}/run` (cell/all, SSE) | Execute over Spark Connect |
| 4d | `GET/POST /v1/notebooks/{id}/revisions`, `POST …/restore` | Versions |
| 4d | `GET /v1/notebooks/{id}/export?format=ipynb\|py` | Export |
| 4e | `GET/PUT/DELETE /v1/{object}/{id}/permissions` | Grant/revoke |
| 4e | `GET/POST /v1/admin/users`, `/v1/admin/groups`, role/group assign | Identity (Keycloak Admin API) |

Error envelope stays `{"error":{"code","message"}}` (see [api/internal/http/respond.go](../../../api/internal/http/respond.go)).

---

## 6. Phases & Definition of Done

| Phase | Summary | DoD anchor (from SPEC-004) |
|---|---|---|
| **4a** | Branded Keycloak login theme (stock image + mounted theme, both runtimes) + punch-list | Branded page serves; `qsuser` logs in; both runtimes; punch-list fixed |
| **4b** | Production clusters: full K8s-native form + lifecycle + tabbed detail (events/logs/metrics) | Create→Ready; all lifecycle actions; detail tabs; identical everywhere; tests |
| **4c** | Catalog browser: tree + columns + sample (Trino) + details + history, via the API | Browse `quicksense.demo.events`; detail tabs; all reads via API; tests |
| **4d** | Notebooks: tree + cell editor + execute on cluster + output + save/version/share/export | Create→attach→run on Iceberg table→inline results; version/restore; share; export; persists; tests |
| **4e** | Object-level authZ server-side + per-user identity + users/groups via Keycloak Admin API | Non-admin scoping enforced server-side; "Can Run" works; reads attributed to real user; identity CRUD; permission-matrix tests |

---

## 7. Testing strategy

- **Go API:** table-driven unit tests + `httptest` handler tests with fakes (existing pattern). K8s via `client-go` **fake dynamic client**; Polaris/Trino/Keycloak via interface fakes + `httptest` servers. Postgres via testcontainers (already used in `store`).
- **UI:** **Vitest + Testing Library** (existing). Component behavior, state machines, BFF route handlers (mock `apiFetch`).
- **Infra contract:** the `pytest` `tests/test_infrastructure_contract.py` suite asserts wiring (theme files exist, realm references theme, compose/kind mounts, endpoints present). Extended per phase.
- **E2E:** `task api-e2e` / round-trip scripts extended where a phase adds an end-to-end path (e.g. 4d notebook run on the demo table).
- **TDD discipline:** red → green → refactor per unit; no implementation without a failing test first.

---

## 8. Air-gapped checklist (enforced every phase)

- No runtime CDN: fonts self-hosted (done); Keycloak theme assets bundled in the theme; CodeMirror bundled via npm; no external script/style/font fetches.
- One config, two runtimes: every change works in Compose **and** kind with the same images/values.
- Control plane ≠ data plane: UI talks only to the Go API.
- Secrets server-side only: Keycloak/Polaris/Trino/MinIO creds never reach the browser.
