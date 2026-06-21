# QuickSense

QuickSense Sprint 1 is a local lakehouse stack: Polaris, MinIO, Spark, Trino, Keycloak, and Postgres for Polaris persistence.

## Two runtimes

QuickSense ships two local runtimes that share the same images and `.env` configuration:

| Runtime | Commands | When to use |
| --- | --- | --- |
| **Docker Compose** — dev mode | `task up` / `task bootstrap` / `task roundtrip` / `task clean` | Fast iteration; containers start in seconds |
| **kind** — Kubernetes tier | `task kind-up` / `task kind-bootstrap` / `task kind-roundtrip` / `task kind-down` | Validates Kubernetes manifests and the K8s config pipeline |

Both runtimes expose the same `localhost` ports and use the same credentials. See
[deploy/k8s/README.md](deploy/k8s/README.md) for the full Kubernetes tier guide, including
prerequisites, the `.env` → ConfigMap/Secret mapping, and the port table.

## 60-second quickstart

Install Docker and [Task](https://taskfile.dev), then run:

```sh
task up
task bootstrap
task roundtrip
```

`task roundtrip` submits a raw PySpark job that writes `quicksense.demo.events` as an Iceberg table, then runs a raw Trino Python client query against `iceberg.demo.events`. Success prints `ROUNDTRIP OK`.

Use `task ps` for health, `task logs -- polaris` for logs, `task down` to stop containers while keeping volumes, and `task clean` to remove volumes for a fresh slate.

## Local URLs and credentials

| Service | URL | Credentials |
| --- | --- | --- |
| Polaris REST catalog | `http://localhost:8181/api/catalog` | `root` / `s3cr3t` |
| Polaris health | `http://localhost:8182/q/health` | none |
| MinIO S3 | `http://localhost:9000` | `minioadmin` / `minioadmin` |
| MinIO console | `http://localhost:9001` | `minioadmin` / `minioadmin` |
| Spark UI | `http://localhost:4040` | none |
| Spark Connect | `sc://localhost:15002` | running after `task up`; Sprint 1 round-trip still uses `spark-submit` inside the container |
| Trino | `http://localhost:8080` | user `quicksense`, no password |
| Keycloak | `http://localhost:8082` | admin `admin` / `admin` |
| Keycloak realm | `http://localhost:8082/realms/quicksense` | client `quicksense-api` / `qs-api-secret`, user `qsuser` / `qs-password` |
| QuickSense API | `kubectl port-forward svc/quicksense-api 8090:8090 -n default` (kind) | Keycloak JWT (see Phase B) |
| QuickSense UI | `http://localhost:3000` (`task ui-dev`) | log in as `qsuser` / `qs-password` via Keycloak |

All defaults are in `.env.example`. `task up` copies it to `.env` if needed. These are development credentials only.

## Bootstrap behavior

`task bootstrap` is idempotent. It creates the MinIO bucket `warehouse`, creates the Polaris catalog `quicksense` with base location `s3://warehouse/quicksense`, grants the dev catalog role content privileges, and verifies Keycloak can issue a client-credentials token by printing `KEYCLOAK OK`.

Polaris uses the internal realm `POLARIS` with `root:s3cr3t` for Sprint 1 engine access. Keycloak is enforced on the QuickSense API: every `/v1/*` request requires a valid Keycloak JWT carrying the `polaris_admin` realm role (Phase B). Polaris runs in **mixed** mode (`polaris.authentication.type=mixed`) and accepts BOTH the internal `root:s3cr3t` credential AND Keycloak JWTs simultaneously — live-verified on Polaris 1.5. A Keycloak JWT with realm role `polaris_admin` is mapped to Polaris principal role `admin` (via `^polaris_(.*)` → `PRINCIPAL_ROLE:$1`) and resolved by `preferred_username` to the bootstrap-created Polaris principal `service-account-quicksense-api`.

For local MinIO, the Polaris catalog is created with `stsUnavailable: true`. In Polaris 1.5 this disables storage credential vending, so Spark and Trino use the static MinIO development credentials from `.env` while still authenticating to Polaris over OAuth2 client credentials.

Polaris metadata is stored in Postgres on the named Docker volume `postgres-data`, so the catalog persists across `task down` and `task up`. `task clean` removes volumes and wipes the catalog.

## Phase B — control-plane API, Spark Operator & OIDC

Phase B adds the Go control-plane API (`api/`, module `github.com/deepiq/quicksense/api`),
the Kubeflow Spark Operator, and Keycloak JWT enforcement.

### QuickSense API

The API is a chi-based HTTP service (`:8080` in-container, exposed as `:8090` by the
Kubernetes Service) with the following routes:

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/healthz` | No | Liveness probe |
| GET | `/v1/catalogs` | Yes | List Polaris catalogs |
| POST | `/v1/catalogs` | Yes | Create a Polaris catalog |
| GET | `/v1/catalogs/{c}/namespaces/{ns}/tables` | Yes | List Iceberg tables |
| POST | `/v1/catalogs/{c}/namespaces/{ns}/tables` | Yes | Create an Iceberg table |
| POST | `/v1/clusters` | Yes | Create a SparkConnect cluster |
| GET | `/v1/clusters` | Yes | List SparkConnect clusters |
| GET | `/v1/clusters/{id}` | Yes | Get a SparkConnect cluster |
| DELETE | `/v1/clusters/{id}` | Yes | Delete a SparkConnect cluster |

All `/v1/*` routes require a valid Keycloak JWT (offline JWKS validation, RS256)
carrying the `polaris_admin` realm role in `Authorization: Bearer <token>`.

The API proxies catalog operations to Polaris using an internal service credential
and manages compute lifecycle by creating/deleting `SparkConnect` custom resources
via the Kubernetes API. It does not run Spark or touch table data directly.

The API maintains its own Postgres database (`QUICKSENSE`, distinct from Polaris's
`POLARIS`) with `workspaces` and `clusters` tables, applied via golang-migrate on
startup.

### Spark Operator

The Kubeflow `spark-operator` Helm chart **2.5.1** is installed into the kind cluster:

- Repo: https://kubeflow.github.io/spark-operator
- Watches the `default` namespace for `SparkConnect` and `SparkApplication` CRs
  (co-located with the base stack: postgres/polaris/minio/trino/keycloak)
- Co-location is required: SparkConnect driver/executor pods must resolve `polaris`
  and `minio` by short name — Polaris advertises short-name REST endpoints, so
  pods in a different namespace fail with `UnknownHostException: polaris`
- An interactive Spark Connect cluster = one `SparkConnect` CR; the operator brings up
  a Spark Connect server reachable at `sc://<cluster-name>-server:15002`
- Uses the same `quicksense-spark` image as Phase A (one image everywhere)
- Chart and operator image are documented for air-gapped mirroring in
  `deploy/k8s/spark-operator/NOTES.md`

### Polaris mixed-mode OIDC

Polaris runs in **mixed** mode (`polaris.authentication.type=mixed`) — live-verified
on Polaris 1.5. Mixed mode accepts BOTH the internal `root:s3cr3t` credential AND
Keycloak JWTs simultaneously with no compromise.

The OIDC tenant (`quarkus.oidc.*`) points at the Keycloak `quicksense` realm. The
principal-roles mapper (`^polaris_(.*)` → `PRINCIPAL_ROLE:$1`) maps the Keycloak realm
role `polaris_admin` to the Polaris principal role `admin`. The principal-mapper
resolves the JWT identity by `preferred_username` (claim path
`polaris.oidc.principal-mapper.name-claim-path=preferred_username`) to the Polaris
principal `service-account-quicksense-api`, which is created by
`ensure_polaris_external_principal` during bootstrap. The `admin` principal role is
bound to `catalog_admin` on the `quicksense` catalog by
`ensure_polaris_admin_principal_role`.

Note: `id-claim-path=sub` must NOT be configured — Polaris parses the principal id as
a numeric long, and a UUID `sub` claim causes NumberFormatException (400).

### Phase B task sequence

```sh
# Full clean-clone sequence
task kind-up && task operator-install && task kind-bootstrap && task api-build && task api-run && task api-e2e
```

| Task | Description |
|------|-------------|
| `task api-build` | Docker-build the API image and `kind load` it into the cluster |
| `task api-run` | Apply `deploy/k8s/api.yaml` and wait for rollout |
| `task operator-install` | Helm-install the Spark Operator (chart 2.5.1) |
| `task api-e2e` | End-to-end flow: Keycloak token → catalog → cluster → SparkConnect roundtrip → Trino |

## Sprint 3 — Run the Web UI

The Next.js web UI (`ui/`) is the first visible slice: log in with Keycloak and
drive the **cluster lifecycle** (list → create → watch reach Ready → delete) end
to end against the real Go API, carrying your Keycloak token.

Because a cluster is a `SparkConnect` CR reconciled by the Spark Operator, the
full flow runs against the **kind** stack (Compose has no operator, so a cluster
can never reach Ready there).

### 1. Bring up the stack on kind

```sh
task up                 # builds the quicksense-spark + trino-client images kind reuses
task kind-up            # base stack (postgres/polaris/minio/trino/keycloak) on kind
task operator-install   # Kubeflow Spark Operator 2.5.1
task kind-bootstrap     # MinIO bucket + Polaris catalog + Keycloak OIDC
task api-build          # build + kind-load the API image
task api-run            # deploy the API (sets KEYCLOAK_ISSUER for browser tokens)
```

> If Keycloak was already running before this sprint, recreate it so the new
> `quicksense-ui` realm client is imported: `task kind-down && task kind-up …`.

### 2. Expose the API to the host

Keycloak is already on `http://localhost:8082` (kind NodePort `30082→8082`).
Port-forward the API:

```sh
kubectl port-forward svc/quicksense-api 8090:8090 -n default &
```

### 3. Configure and start the UI

```sh
cd ui
cp .env.local.example .env.local
# Set AUTH_SECRET (openssl rand -base64 32).
# AUTH_KEYCLOAK_SECRET must equal KEYCLOAK_UI_CLIENT_SECRET from the repo .env (default qs-ui-secret).
task ui-install        # or: npm install
task ui-dev            # http://localhost:3000
```

Visiting `http://localhost:3000` redirects to Keycloak. Log in as **`qsuser` /
`qs-password`**, land on the Clusters page, create a cluster, watch its phase
badge reach **Ready** (polling), then delete it. Log out from the top-right menu.

### UI environment variables (`ui/.env.local`)

| Variable | Purpose | Default |
|---|---|---|
| `AUTH_SECRET` | Auth.js session encryption | (generate) |
| `AUTH_KEYCLOAK_ID` | OIDC client id | `quicksense-ui` |
| `AUTH_KEYCLOAK_SECRET` | OIDC client secret (matches `KEYCLOAK_UI_CLIENT_SECRET`) | `qs-ui-secret` |
| `AUTH_KEYCLOAK_ISSUER` | Keycloak realm issuer | `http://localhost:8082/realms/quicksense` |
| `QUICKSENSE_API_BASE_URL` | Go API base (port-forwarded) | `http://localhost:8090` |

### How the token reaches the API

Auth.js runs the Authorization Code + PKCE flow against the `quicksense-ui`
confidential client and stores the access token **server-side** in an HttpOnly
session. The browser never sees the token: client components poll same-origin
Next.js route handlers (`/api/clusters*`), which read the session server-side and
forward `Authorization: Bearer <token>` to the Go API. Because the browser mints
its token via `localhost:8082`, the API is configured with
`KEYCLOAK_ISSUER=http://localhost:8082/realms/quicksense` (it still fetches JWKS
from the in-cluster `keycloak:8082`).

`task ui-build` runs lint + typecheck + the production build; `task ui-test` runs
the unit/component suite.

## Build-time downloads

The Spark image downloads pinned Iceberg jars from Maven Central:

- `org.apache.iceberg:iceberg-spark-runtime-4.0_2.13:1.10.0`
- `org.apache.iceberg:iceberg-aws-bundle:1.10.0`

The Trino helper image installs the pinned Python client `trino==0.337.0` at image build time.

## Branded login (themed Keycloak)

The login page is QuickSense-branded via a Keycloak **login theme** — not a fork or
custom build. Keycloak runs the **stock image** (`quay.io/keycloak/keycloak`) with the
theme **mounted** in:

- `docker/keycloak/themes/quicksense/` — `theme.properties` (inherits `parent=keycloak`,
  so MFA / forgot-password / registration flows stay intact), `login/resources/css/login.css`
  (indigo palette, centered card), and `login/resources/img/logo.svg` (the Q-pulse mark).
  All assets are self-hosted — no CDN (air-gapped).
- The realm (`realm-quicksense.json`) selects it with `"loginTheme": "quicksense"`.
- **Compose** bind-mounts the theme at `/opt/keycloak/themes/quicksense`; **kind** mounts it
  from the `keycloak-theme` ConfigMap (created by `scripts/k8s/kind-up.sh`). Same theme, both
  runtimes.

Auth is unchanged from Sprint 3 (Authorization Code + PKCE); only the page styling differs.
