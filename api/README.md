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
  ├── GET  /healthz          — unauthenticated liveness probe
  └── /v1  [RequireAuth]
       ├── GET  /catalogs
       ├── POST /catalogs
       ├── GET  /catalogs/{catalog}/namespaces/{namespace}/tables
       └── POST /catalogs/{catalog}/namespaces/{namespace}/tables
       # NOTE: /v1/clusters routes are added in B12-B14
```

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

Routes under `/v1` require a valid Keycloak JWT with the `polaris_admin` realm
role in the `Authorization: Bearer <token>` header.

Cluster management routes (`/v1/clusters`) are wired in B12-B14 (Spark Connect
compute planner).

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

A Deployment manifest is added in B21. Until then use the Docker image:

```sh
docker build -t quicksense-api:dev api/
```

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
