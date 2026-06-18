# QuickSense

QuickSense Sprint 1 is a local lakehouse stack: Polaris, MinIO, Spark, Trino, Keycloak, and Postgres for Polaris persistence.

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

All defaults are in `.env.example`. `task up` copies it to `.env` if needed. These are development credentials only.

## Bootstrap behavior

`task bootstrap` is idempotent. It creates the MinIO bucket `warehouse`, creates the Polaris catalog `quicksense` with base location `s3://warehouse/quicksense`, grants the dev catalog role content privileges, and verifies Keycloak can issue a client-credentials token by printing `KEYCLOAK OK`.

Polaris uses the internal realm `POLARIS` with `root:s3cr3t` for Sprint 1 engine access. Keycloak is wired but not enforced: the `quicksense` realm, `quicksense-api` confidential client, `qsuser` test user, and `polaris_admin` realm role are imported and token issuance is verified, but Polaris external OIDC enforcement is deferred to Sprint 2.

For local MinIO, the Polaris catalog is created with `stsUnavailable: true`. In Polaris 1.5 this disables storage credential vending, so Spark and Trino use the static MinIO development credentials from `.env` while still authenticating to Polaris over OAuth2 client credentials.

Polaris metadata is stored in Postgres on the named Docker volume `postgres-data`, so the catalog persists across `task down` and `task up`. `task clean` removes volumes and wipes the catalog.

## Build-time downloads

The Spark image downloads pinned Iceberg jars from Maven Central:

- `org.apache.iceberg:iceberg-spark-runtime-4.0_2.13:1.10.0`
- `org.apache.iceberg:iceberg-aws-bundle:1.10.0`

The Trino helper image installs the pinned Python client `trino==0.337.0` at image build time.
