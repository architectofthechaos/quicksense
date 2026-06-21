# SPEC-004e Design — AuthN/AuthZ across the product

Parent: program design. The governance layer tying clusters, catalog, notebooks together with object-level permissions + real per-user identity.

## Permission model (migration 0004)
`permissions(id, object_type, object_id, principal_type /* user|group */, principal_id, level, granted_by, created_at, UNIQUE(object_type,object_id,principal_type,principal_id))`.

| object_type | levels |
|---|---|
| `cluster` | `attach`, `manage` |
| `notebook` | `view`, `run`, `edit`, `manage` |
| `table` (catalog) | surfaced from **Polaris grants** (read here; grant/revoke via Polaris) |

Levels are ordered; a higher level implies lower ones. Owner ⇒ `manage`. Realm-admin role ⇒ implicit `manage` on all.

## Server-side enforcement (D8)
- `authz.Authorize(ctx, principal, objectType, objectID, required level) error` — computes the principal's **effective level** = max(direct user grant, grants for the principal's Keycloak groups, owner, admin). Returns `403` if below required.
- Every object handler calls it (e.g. cluster stop ⇒ `cluster:manage`; notebook run ⇒ `notebook:run`). List endpoints **filter** to permitted objects.
- The principal (`preferred_username`, `sub`, groups) comes from the validated JWT (`auth.RequireAuth` extended to surface groups).

## Per-user identity (D7 — brokered per-user tokens)
- Notebook execution + catalog/table reads are attributed to the **real logged-in user**, not the shared service principal.
- Mechanism: the API uses the caller's Keycloak token (already received as Bearer) to authenticate to **Polaris** (external OIDC maps by `preferred_username` to a per-user Polaris principal) and sets the **Trino** session user to the principal. Spark Connect sessions are per-user.
- Verify via Polaris audit / token claims that a table read carries the user identity (DoD §3). RFC 8693 token-exchange documented as the upgrade path.

## Users & Groups (Keycloak Admin API)
- New `api/internal/keycloak` admin client (client-credentials, admin realm client): list/create users, create groups, assign realm roles + group membership.
- Endpoints: `GET/POST /v1/admin/users`, `GET/POST /v1/admin/groups`, `PUT /v1/admin/users/{id}/groups`, `PUT /v1/admin/users/{id}/roles`. Guarded by an admin entitlement.

## Permissions endpoints
- `GET /v1/clusters/{id}/permissions`, `PUT` (grant), `DELETE` (revoke) — and the same for `notebooks`. Table permissions read from Polaris grants.

## UI
- **Identity & Access** screen (new nav "Admin" group): Users (list/create), Groups (create, membership), role/entitlement assignment — via the admin endpoints.
- **Permissions tabs** on cluster / catalog / notebook detail become functional: `PermissionsEditor` (principal search → level select → grant; list + revoke).
- Non-admins: actions they lack are hidden (cosmetic) — server still enforces.

## Tests
- Go: **permission matrix** — for each (object_type, level, principal scenario: direct/group/owner/admin/none) assert allow/deny; list-filtering tests; Keycloak admin client (httptest); per-user identity propagation (Trino session user, Polaris auth header derived from caller token).
- UI: permissions editor grant/revoke; identity screen create user/group; hidden-action reflection.

## DoD
Non-admin sees only permitted objects; lacked actions blocked **server-side**. Granting `qsuser2` "Can Run" on a notebook ⇒ run yes, edit no. A table read in a notebook is attributed to the real user against Polaris (verify via audit/claims). Users & Groups screen creates a user + group + assigns a role via the Keycloak Admin API. Server-side authz tests (matrix) + UI tests.
