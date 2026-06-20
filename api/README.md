# QuickSense API

The QuickSense API is the control-plane front door for the QuickSense platform.
It manages catalogs (via Apache Polaris) and compute lifecycle (Spark Connect
clusters via the Kubernetes operator, wired in B14). Handlers are thin; all
domain logic lives in `internal/`.

## Architecture

```
client
  │  Bearer JWT (Keycloak RS256)
  ▼
chi router (:8080)
  ├── GET  /healthz                                                   — unauthenticated liveness probe
  └── /v1  [RequireAuth — polaris_admin realm role]
       ├── GET  /catalogs
       ├── POST /catalogs
       ├── GET  /catalogs/{catalog}/namespaces/{namespace}/tables
       ├── POST /catalogs/{catalog}/namespaces/{namespace}/tables
       ├── POST /clusters                                             — create SparkConnect CR
       ├── GET  /clusters                                             — list SparkConnect CRs
       ├── GET  /clusters/{id}                                        — get SparkConnect CR
       └── DELETE /clusters/{id}                                      — delete SparkConnect CR
```

The API proxies catalog operations to Polaris using its internal service credential.
Cluster operations create and manage `SparkConnect` custom resources via the Kubernetes
API; the Kubeflow Spark Operator (chart 2.5.1) reconciles them into Spark Connect
servers reachable at `sc://<cluster-name>-server:15002`.

The API owns a separate Postgres database (`QUICKSENSE`, distinct from Polaris's `POLARIS`)
with `workspaces` and `clusters` tables applied via golang-migrate on startup.

## Environment variables

All values are sourced from environment variables (typically loaded from `.env`
by Docker Compose, or from a ConfigMap/Secret in kind):

| Variable                  | Default     | Description                                      |
|---------------------------|-------------|--------------------------------------------------|
| `POSTGRES_HOST`           | `postgres`  | Postgres hostname                                |
| `POSTGRES_USER`           | —           | Postgres username                                |
| `POSTGRES_PASSWORD`       | —           | Postgres password (secret)                       |
| `POSTGRES_PORT`           | —           | Postgres port (e.g. `5432`)                      |
| `POLARIS_HOST`            | `polaris`   | Polaris hostname                                 |
| `POLARIS_PORT`            | —           | Polaris port (e.g. `8181`)                       |
| `POLARIS_REALM`           | —           | Polaris realm header value (e.g. `POLARIS`)      |
| `POLARIS_CLIENT_ID`       | —           | OAuth2 client ID for Polaris                     |
| `POLARIS_CLIENT_SECRET`   | —           | OAuth2 client secret for Polaris (secret)        |
| `POLARIS_CATALOG`         | —           | Default Polaris catalog name (e.g. `quicksense`) |
| `KEYCLOAK_HOST`           | `keycloak`  | Keycloak hostname                                |
| `KEYCLOAK_PORT`           | —           | Keycloak port (e.g. `8082`)                      |
| `KEYCLOAK_REALM`          | —           | Keycloak realm (e.g. `quicksense`)               |
| `KEYCLOAK_CLIENT_ID`      | —           | Keycloak client ID                               |
| `KEYCLOAK_CLIENT_SECRET`  | —           | Keycloak client secret (secret)                  |
| `REQUIRED_ROLE`           | `polaris_admin` | Keycloak realm role required on every `/v1` request |

## Routes

| Method | Path                                                       | Auth | Description               |
|--------|------------------------------------------------------------|------|---------------------------|
| GET    | `/healthz`                                                 | No   | Liveness probe → `200 OK` |
| GET    | `/v1/catalogs`                                             | Yes  | List Polaris catalogs      |
| POST   | `/v1/catalogs`                                             | Yes  | Create a Polaris catalog   |
| GET    | `/v1/catalogs/{catalog}/namespaces/{namespace}/tables`     | Yes  | List Iceberg tables        |
| POST   | `/v1/catalogs/{catalog}/namespaces/{namespace}/tables`     | Yes  | Create an Iceberg table    |
| POST   | `/v1/clusters`                                             | Yes  | Create a SparkConnect cluster |
| GET    | `/v1/clusters`                                             | Yes  | List SparkConnect clusters |
| GET    | `/v1/clusters/{id}`                                        | Yes  | Get a SparkConnect cluster |
| DELETE | `/v1/clusters/{id}`                                        | Yes  | Delete a SparkConnect cluster |

Routes under `/v1` require a valid Keycloak JWT with the `polaris_admin` realm
role in the `Authorization: Bearer <token>` header (offline JWKS validation, RS256).

An interactive Spark Connect cluster = one `SparkConnect` CR managed by the Kubeflow
Spark Operator (chart 2.5.1). Once reconciled, the cluster is reachable at
`sc://<cluster-name>-server:15002`.

## Running locally

### Prerequisites

- Go 1.25+ (toolchain 1.26 recommended; pinned libraries require this — see
  `go.mod` `toolchain go1.26.0`)
- A running Postgres instance with the `QUICKSENSE` database (the API creates
  it automatically via `EnsureDatabase` on start)
- A running Polaris instance
- A running Keycloak instance with the `quicksense` realm

### With Docker Compose

The easiest way is to start the full stack and then run the API against it:

```sh
# In repo root — start infrastructure
task up
task bootstrap

# In api/ — run the API server (env vars from .env)
export $(grep -v '^#' ../.env | xargs)
go run ./cmd/quicksense-api
```

### Standalone (with a .env file)

```sh
cd api
set -a && source ../.env && set +a
go run ./cmd/quicksense-api
```

The server logs startup progress and listens on `:8080`.

### In kind (Kubernetes)

Use the Taskfile targets which build and deploy the API into the kind cluster:

```sh
# From repo root
task api-build   # docker build + kind load
task api-run     # apply deploy/k8s/api.yaml, wait for rollout
```

The API is deployed into the `default` namespace as `deploy/k8s/api.yaml` (Deployment
+ Service + ServiceAccount + RBAC for SparkConnect CRs), co-located with the base
stack (polaris/minio/trino/keycloak) so SparkConnect driver/executor pods resolve
short-name DNS (e.g. `polaris`, `minio`). The Service exposes port 8090.
To reach the API from your laptop:

```sh
kubectl port-forward svc/quicksense-api 8090:8090 -n default
```

Then obtain a Keycloak token and call the API:

```sh
TOKEN=$(curl -s -X POST \
  http://localhost:8082/realms/quicksense/protocol/openid-connect/token \
  -d grant_type=client_credentials \
  -d client_id=quicksense-api \
  -d client_secret=qs-api-secret \
  | jq -r .access_token)

curl -H "Authorization: Bearer $TOKEN" http://localhost:8090/v1/catalogs
```

The full end-to-end flow is automated by `task api-e2e` (runs `scripts/k8s/api-e2e.sh`).

## Docker image

```sh
# Build (context is api/)
docker build -t quicksense-api:dev api/

# Run (pass env vars from .env)
docker run --rm --env-file .env -p 8080:8080 quicksense-api:dev
```

The multi-stage build uses:
- Builder: `golang:1.26-alpine`
- Runtime: `gcr.io/distroless/static-debian12` (no shell, minimal surface)

SQL migrations are embedded via `//go:embed` — no migration files need to be
copied separately at runtime.

## Go toolchain note

The module requires **Go 1.25+** (`go 1.25.0` in `go.mod`). The recommended
toolchain is **Go 1.26** (`toolchain go1.26.0`) because
`testcontainers-go v0.42` pulled in a minimum toolchain requirement that
lands at 1.26.

Key pinned dependencies:

| Package                          | Version   |
|----------------------------------|-----------|
| `github.com/go-chi/chi/v5`       | v5.1.0    |
| `github.com/jackc/pgx/v5`        | v5.7.1    |
| `github.com/golang-migrate/migrate/v4` | v4.19.1 |
| `github.com/golang-jwt/jwt/v5`   | v5.2.1    |
| `github.com/MicahParks/keyfunc/v3` | v3.3.6  |

## Tests

```sh
cd api
# Unit + offline integration tests (no external services needed)
go test ./...

# Gated integration tests (require a real Postgres; uses testcontainers)
INTEGRATION=1 go test ./internal/store/...
```
