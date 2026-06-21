# SPEC-004 — Decisions & Status Report

- **Started:** 2026-06-20 (autonomous, multi-phase build)
- **Branch:** `implement-spec-004-tdd`
- **Mode:** Autonomous — owner delegated all design/approval decisions; "keep going until everything is finished" with a decisions report.
- **Method:** TDD throughout; small green increments; every commit builds and passes `go test ./...` + UI Vitest + tsc + lint.

---

## 1. Overall progress

```
SPEC-004  ████████████████████  100%
4a Login ✅100%  4b Clusters ✅100%  4c Catalog ✅100%  4d Notebooks ✅100%  4e AuthZ ✅100%
```

**All SPEC-004 code is written, unit/integration-verified, AND live-verified end-to-end on a real kind cluster.** The full multi-component live smoke passed: themed login; cluster create-with-resources via the API (SparkConnect CR with exact driver/executor resources, tags→annotations, dynamic-allocation autoscaling, server pod Ready); catalog browse (catalogs/namespaces/tables/table-detail-with-history + Trino sample, all real data); notebook create→attach→run returning **real Iceberg rows** through the API→broker→Spark Connect path; revisions + export (.ipynb/.py); and the complete authz lifecycle (denial → grant → level-ladder → revoke), the `quicksense_admin` admin gate, and **live per-user attribution** (Trino's audit log shows `qsuser` vs `service-account-quicksense-api` distinctly). The live smoke also surfaced and fixed a real regression (see §9).

| Phase | State | Evidence |
|---|---|---|
| Program + 5 phase design docs | ✅ Complete | `2026-06-20-spec-004*.md` |
| **4a** Branded Keycloak login + punch-list | ✅ **Complete, verified live** | `b52a3a6` |
| **4b** Production clusters (backend + UI) | ✅ **Complete** | `7d6b5a2` `7e921ae` `61bf59f` `27b7a70` |
| **4c** Catalog browser (backend + UI) | ✅ **Complete** (read-first) | `281ba04` `c67a547` `5e9de68` |
| **4d** Notebooks | ✅ **Complete, live-verified** — create→attach→run returns real Iceberg rows via API→broker→Spark Connect; revisions + export (.ipynb/.py) | `0f4691f` `8c241a4` `497d468` `7ff995e` `2302bd4` `332f191` |
| **4e** AuthN/AuthZ | ✅ **Complete, live-verified** — object-level enforcement (denial→grant→ladder→revoke), admin gate, per-user Trino attribution; Polaris on service identity (per-user deferred to token-exchange — §9) | `4a5612e` `d5597cb` `7712033` `04f259f` `cc5f0bb` |

---

## 2. Working agreement
Owner is unavailable and delegated all decisions, asking me to implement autonomously with TDD and report. No approval gates; I adopted my own recommendations as decisions, parallelized UI builds via subagents (each verified green before integration), and committed each increment. Recorded to memory as `spec-004-autonomous-implementation`.

---

## 3. Decisions taken
Program-level **D1–D11** are in `2026-06-20-spec-004-program-design.md` (full-width enterprise console evolving the indigo tokens; SSE→**polling** chosen for logs; Python Spark-Connect broker for notebook exec; brokered per-user tokens; CodeMirror; read-first catalog; 4d split).

Implementation-level decisions made while building:
- **4a:** system-font login theme (logo+indigo carry the brand; air-gapped), CSS-only Keycloak override (no FTL fork), realm `loginTheme`. Punch-list: `devIndicators:false`, NAME-column nowrap, Connected pill verified.
- **4b:** tags→`quicksense.io/*` annotations (not labels); autoscaling via Spark dynamic allocation (user sparkConf wins); full create config persisted as one `config` JSONB so Start/Restart re-render the exact CR; **driver logs as tail-N text + UI polling** (server WriteTimeout 60s makes SSE-follow awkward); metrics best-effort stub.
- **4c:** Polaris catalog → Trino catalog mapping for sample; nested Iceberg field types resolved; BFF catch-all GET proxy for catalog reads.
- **4d:** full create config + notebook content stored as JSONB; export = Jupytext `# %%` (.py) + nbformat v4 (.ipynb); `/run` returns 501 until the broker exists.
- **4e:** per-object-type level ladders; effective = max(admin, owner, direct, group); permission store upsert; level validated against the ladder.

---

## 4. Git state (this build)
```
7ff995e feat(4d): notebook /run endpoint stub (501 until Spark Connect broker)
5e9de68 feat(4c): catalog browser UI — tree + tabbed table detail
d5597cb feat(4e): permission store + grant/revoke/list endpoints
4a5612e feat(4e): object-level authorization model + permission matrix
497d468 feat(4d): notebook CRUD + revisions + export endpoints
8c241a4 feat(4d): notebook store — CRUD + revisions
27b7a70 feat(4b): production clusters UI — full-width console, lifecycle, tabbed detail
61bf59f feat(4b): cluster events + driver logs + metrics + idle auto-terminate
7e921ae feat(4b): cluster config persistence + lifecycle start/stop/restart/clone/pin
0f4691f feat(4d): notebooks storage migration 0003
c67a547 feat(4c): Trino sample-data client + endpoint
281ba04 feat(4c): catalog namespaces + Iceberg table metadata via Polaris
7d6b5a2 feat(4b): production pod resources on cluster create
b52a3a6 feat(4a): QuickSense-branded Keycloak login theme + punch-list
c4ecb40 docs(spec-004): program + 4a-4e phase design docs
a631c86 fix(e2e): Polaris bind idempotency + Keycloak issuer Host header + status polling
```

---

## 5. Status by phase

**4a ✅** Theme served by stock Keycloak 26.3 (verified live: active theme path `/login/quicksense`, our CSS/logo served, air-gapped, login form intact). Punch-list done.

**4b ✅** Backend: full K8s-native create (resources, autoscaling, env, tags), lifecycle (start/stop/restart/clone/pin), config persistence, events, driver logs (tail text), metrics (best-effort), idle auto-terminate reconciler. UI: full-width console, data table with row actions, rich create form (ResourceFields + KeyValueEditors), tabbed detail (Overview/Events/Logs/Metrics/Permissions). DoD met except live SSE-follow logs (polling instead) and metrics-server (stub).

**4c ✅** Backend: Polaris ListNamespaces + LoadTable (columns/details/history), Trino sample client + endpoint. UI: two-pane tree + tabbed detail (Columns/Sample/Details/History/Permissions). Read-first (create-namespace/table intentionally deferred per D10).

**4d ✅** Backend: notebook store (CRUD, attach, soft-trash), revisions (save/list/restore), export (.ipynb/.py). UI: file tree + CodeMirror cell editor + versions/share/export. **Execution live** — the Python Spark-Connect broker is deployed; `POST …/run` resolves the attached cluster's `sc://…-server:15002`, relays through the broker, and the marquee "run a cell on the Iceberg table" returns **real rows** (verified live, §8).

**4e ✅** The authorization model (`authz` package, 12-case matrix), the permission store + grant/revoke/list endpoints, **`authz.Allows` enforcement on every cluster + notebook handler** (groups/admin surfaced from the JWT), the Keycloak Admin users/groups/roles endpoints + screen, and the Permissions/Identity UI. Per-user identity: **Trino `X-Trino-User` = caller (live-verified)**; **Polaris on service identity** (per-user deferred to token-exchange — §9). Enforcement verified live: denial→grant→level-ladder→revoke + admin gate (§8).

---

## 6. Verification
- **Go:** `go test ./...` green across auth, authz, config, http, k8s, polaris, store, trino. Integration (`-tags=integration`) green — migrations 0001→0004 apply against real Postgres.
- **UI:** Vitest green and growing (51 → 114 after 4b → 159 after 4c); tsc + eslint clean; `next build` succeeds. (Notebooks UI verified by its build agent before integration.)
- **4a live:** confirmed on a throwaway stock Keycloak.

---

## 7. Remaining work (resume checklist)
Done since the last revision: ✅ notebooks UI, ✅ notebook ownership, ✅ server-side **notebook** permission enforcement (matrix tested), ✅ functional Permissions UI (clusters + notebooks).

✅ Also done since: **4e cluster enforcement** (migration 0005 + gate on all cluster handlers, matrix-tested); **4e Keycloak Admin** (admin client + `/v1/admin/users|groups|roles` endpoints, httptest-verified) + the **Users & Groups screen** (`/app/admin`).

✅ Also done since: **4d execution broker** — `docker/broker/broker.py` (pyspark[connect]) + Go relay (`/run` resolves the attached cluster's sc:// endpoint and relays) + `deploy/k8s/base/broker.yaml` + Taskfile targets. **LIVE-VERIFIED**: ran `spark.sql("SELECT * FROM quicksense.demo.events").show()` through the deployed broker against the running Spark Connect cluster → returned the real Iceberg rows (DoD #2 ✅).

✅ Also done since: **4e per-user identity** — RequireAuth stashes the caller's token + principal in context; the Polaris client forwards that token (external OIDC maps the user) and the Trino client sets `X-Trino-User` to the caller, so reads + (broker) execution attribute to the real user. Unit-tested (Polaris forwards + skips the service token; Trino X-Trino-User=caller).

**Nothing open — the full live smoke passed.** See §8 for the evidence and §9 for the regression it caught.

---

## 8. Live smoke — end-to-end evidence (real kind cluster)

Driven against the deployed branch images (API pod + `spark-broker` + Polaris + Trino + Keycloak) via the API on `localhost:8090`. Two identities used: the `quicksense-api` service account and `qsuser` (realm user, `polaris_admin` only — non-admin, non-owner). **Re-confirmed 2026-06-21** via the documented deploy path (`kind load` → `task api-run` → `kubectl rollout restart` → fresh pod), all results below reproduced green.

**Token issuer (verified A/B):** the API is configured (`deploy/k8s/api.yaml`) with `KEYCLOAK_ISSUER=http://localhost:8082/realms/quicksense` *by design* — browser-minted tokens carry the login host (`localhost:8082`), while the API fetches JWKS internally from `keycloak:8082`. Demonstrated live: a token minted with `Host: keycloak:8082` (`iss=keycloak:8082`) → **401** on `/v1/catalogs`; the same grant without the Host override (`iss=localhost:8082`) → **200**. So the smoke mints against `localhost:8082`. (Note: `scripts/k8s/api-e2e.sh` still defaults `KEYCLOAK_ISSUER_HOST=keycloak:8082` — only correct if that script also deploys the API with a matching issuer; the committed `deploy/k8s/api.yaml` uses `localhost:8082`.)

| Flow | Call | Result |
|---|---|---|
| **4b** create w/ resources | `POST /v1/clusters` (driver/executor cpu+mem, min/max, env, tags) | `201`; SparkConnect CR has exact `requests/limits`, tags→`quicksense.io/*` annotations, `spark.dynamicAllocation.*` (min/max), catalog sparkConf; **server pod Ready, 1 executor running** |
| **4c** catalogs | `GET /v1/catalogs` | `200` `{quicksense, INTERNAL}` |
| **4c** namespaces | `GET …/quicksense/namespaces` | `200` `{demo}` |
| **4c** tables | `GET …/demo/tables` | `200` `{events}` |
| **4c** table detail | `GET …/tables/events` | `200`; location, `iceberg/v2`, columns (id/name/ts), full snapshot history (append/delete) |
| **4c** sample (Trino) | `GET …/events/sample` | `200`; real rows alpha/bravo/charlie |
| **4d** notebook run | create → `POST …/attach` → `POST …/run` | `200`; **real Iceberg rows** via API→`sc://…-server:15002`→broker→Spark Connect |
| **4d** revisions | `POST` + `GET …/revisions` | `201` / `200` (author recorded) |
| **4d** export | `GET …/export?format=ipynb\|py` | `200`; valid nbformat v4 + Jupytext `# %%` |
| **4e** denial | qsuser `GET`/`run` on SA's notebook | `403` / `403` (non-owner, no grant) |
| **4e** grant + ladder | owner `PUT …/permissions` view → qsuser `GET` / `run` | grant `200`; then `GET 200` (view) but `run 403` (view < run) |
| **4e** revoke | `DELETE …/permissions?principal_*` → qsuser `GET` | `204` → `403` (access removed) |
| **4e** admin gate | SA & qsuser `GET /v1/admin/users` | `403` / `403` (neither has `quicksense_admin`) |
| **4e** per-user attribution | sample as qsuser vs SA → Trino `system.runtime.queries` | log shows `qsuser` and `service-account-quicksense-api` on their respective reads (**DoD #3 proven**) |
| cleanup | `DELETE` notebook + cluster | `204` / `204` |

---

## 9. Regression caught & fixed by the smoke

The per-user identity change had the Polaris client forward the caller's Keycloak token. Live, this made all Polaris reads (`/v1/catalogs`, namespaces, table detail) return **401** while the Trino sample returned 200.

**Root cause:** a split issuer in this deployment — the API verifies browser tokens minted against `localhost:8082`, but Polaris's OIDC expects `keycloak:8082`. One forwarded token cannot satisfy both validators, so Polaris rejects it. Per-user Polaris attribution needs a shared issuer or RFC 8693 token-exchange (already deferred in the program design).

**Fix (`cc5f0bb`):** Polaris always authenticates with its own service credential; Trino keeps per-user `X-Trino-User` (which needs no token validation and is live-verified). A unit test now locks the decision in: a caller token in context must **not** leak to Polaris. Per-user Polaris attribution lands when token-exchange does.

---

## 10. Risks & notes
- **Execution broker (D5)** — was the biggest unproven piece; now **live-verified** (real Iceberg rows through the full API→broker→Spark Connect path).
- Driver logs are **polled tail-text**, not SSE-follow (deliberate, given the 60s server write timeout).
- Per-user **Polaris** attribution is deferred to token-exchange (§9); per-user **Trino** attribution works today.
- Some pre-existing files carry gofmt-version nits I left untouched (scope discipline); all *new* code is gofmt-clean.
