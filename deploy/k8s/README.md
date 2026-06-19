# QuickSense — Kubernetes Tier (kind)

This directory contains the kind Kubernetes tier for QuickSense. It runs the same six services
(Polaris, MinIO, Spark, Trino, Keycloak, Postgres) on a local [kind](https://kind.sigs.k8s.io/)
cluster, sharing the same images and `.env` values as the Docker Compose dev tier.

---

## Prerequisites

| Tool | Notes |
| --- | --- |
| [kind](https://kind.sigs.k8s.io/docs/user/quick-start/#installation) | Kubernetes-in-Docker |
| [kubectl](https://kubernetes.io/docs/tasks/tools/) | Kubernetes CLI |
| Docker | Running daemon required by kind |
| [Task](https://taskfile.dev) | Task runner (Taskfile.yml in repo root) |

**Build the images first.** The kind cluster cannot pull locally-built images from a registry.
Run the Compose dev mode stack first so the images exist in the local Docker daemon:

```sh
task up
```

This builds `quicksense-spark:latest` and `quicksense-trino-client:latest` via `docker compose
--build`. Once built, `kind load docker-image` loads them into the cluster automatically during
`task kind-up`.

---

## The four commands

### `task kind-up`

Creates the kind cluster named `quicksense` (from `deploy/k8s/kind-cluster.yaml`), loads locally-built
images, generates ConfigMaps and Secrets from `.env` and the existing config files, then applies all
six service manifests in dependency order and waits for each to roll out.

```sh
task kind-up
```

### `task kind-bootstrap`

Bootstraps the cluster: creates the MinIO `warehouse` bucket via a one-shot `minio/mc` pod, registers
the Polaris catalog and grants, and verifies that Keycloak can issue a client-credentials token.
Reuses the shared helpers in `scripts/lib/bootstrap-common.sh` via `kubectl port-forward` — the exact
same logic as `task bootstrap` on Compose.

```sh
task kind-bootstrap
```

### `task kind-roundtrip`

Runs the end-to-end data round-trip against the live cluster:

1. **Spark write** — `kubectl exec` into the Spark Connect pod and run `spark-submit
   /workspace/scripts/roundtrip/spark_write.py`. The script is byte-identical to the Compose
   round-trip; no changes were needed to move it to Kubernetes.
2. **Trino read** — applies `deploy/k8s/base/trino-read-job.yaml`, waits for the Job to complete,
   and greps the logs for `ROUNDTRIP OK`.

```sh
task kind-roundtrip
```

### `task kind-down`

Deletes the kind cluster entirely.

```sh
task kind-down
```

**Warning:** `task kind-down` deletes the cluster and wipes all data. Unlike `task down` (Compose),
which preserves named volumes, there are no persistent volumes outside the cluster. All Postgres
catalog metadata and MinIO objects are lost.

---

## Configuration — one source of truth

K8s configuration is **generated at apply time** from the same `.env` file and the same existing
config files used by Docker Compose. Nothing is hand-duplicated.

`task kind-up` (via `scripts/k8s/kind-up.sh`) creates two Kubernetes objects from `.env`:

| Object | Type | Content |
| --- | --- | --- |
| `qs-config` | ConfigMap | All keys from `.env` via `--from-env-file` |
| `qs-secrets` | Secret | Six sensitive keys via `--from-literal` (see below) |

The six sensitive keys that go into `qs-secrets`:
`POSTGRES_PASSWORD`, `POLARIS_CLIENT_SECRET`, `MINIO_ROOT_PASSWORD`,
`KEYCLOAK_ADMIN_PASSWORD`, `KEYCLOAK_CLIENT_SECRET`, `KEYCLOAK_TEST_PASSWORD`.

At pod startup each container's `envFrom` lists `configMapRef: qs-config` before
`secretRef: qs-secrets`. Because later entries win, the Secret values override the same keys that
happen to be in the ConfigMap — the desired behaviour for local dev.

Four additional file-based ConfigMaps are generated from the **same** source files used by Compose:

| ConfigMap | Source files |
| --- | --- |
| `trino-etc` | `docker/trino/etc/config.properties`, `node.properties`, `jvm.config`, `log.properties` |
| `trino-catalog` | `docker/trino/etc/catalog/iceberg.properties` |
| `keycloak-realm` | `docker/keycloak/realm-quicksense.json` |
| `roundtrip-scripts` | `scripts/roundtrip/spark_write.py`, `scripts/roundtrip/trino_read.py` |

The dotted Quarkus feature-flag keys for Polaris (e.g.
`polaris.features."ALLOW_INSECURE_STORAGE_TYPES"`) cannot be expressed as `.env` keys.
They live as literal `env:` entries directly in `deploy/k8s/base/polaris.yaml` rather than in
`.env`. See `deploy/k8s/config/README.md` for details.

---

## Spark — Spark Connect in Phase A

`deploy/k8s/base/spark.yaml` deploys Spark as a **Spark Connect** Deployment: the pod exposes
port 15002 (Spark Connect gRPC) and 4040 (Spark UI).

Phase A round-trips use `kubectl exec` + `spark-submit` inside the running pod so that
`scripts/roundtrip/spark_write.py` is byte-identical between Compose and kind — no Spark Connect
client code changes were needed. The `sc://` connection string and client-side Spark Connect usage
are deferred to Phase B.

---

## Persistent Volume Claims

Two services use PVCs for data durability across pod restarts (within a running cluster):

| PVC | Service | Mount |
| --- | --- | --- |
| `postgres-pvc` | Postgres | `/var/lib/postgresql/data` |
| `minio-pvc` | MinIO | `/data` |

PVCs are provisioned by kind's default `local-path` StorageClass. Data is lost when
`task kind-down` deletes the cluster.

---

## Port mapping table

The kind cluster configuration (`deploy/k8s/kind-cluster.yaml`) maps NodePort Services to
host ports so the same `localhost:PORT` URLs work on both Compose and kind:

| Host port | NodePort | Service | URL |
| --- | --- | --- | --- |
| `localhost:8181` | 30181 | Polaris REST catalog | `http://localhost:8181/api/catalog` |
| `localhost:9000` | 30900 | MinIO S3 API | `http://localhost:9000` |
| `localhost:9001` | 30901 | MinIO web console | `http://localhost:9001` |
| `localhost:4040` | 30040 | Spark UI | `http://localhost:4040` |
| `localhost:8080` | 30080 | Trino | `http://localhost:8080` |
| `localhost:8082` | 30082 | Keycloak | `http://localhost:8082` |

Credentials are the same as the Compose dev tier — see root `README.md`.

---

## File layout

```
deploy/k8s/
├── kind-cluster.yaml          # kind Cluster config with extraPortMappings
├── config/
│   └── README.md              # .env → ConfigMap/Secret mapping reference
└── base/
    ├── postgres.yaml          # Deployment + Service + PVC
    ├── minio.yaml             # Deployment + Service + PVC
    ├── polaris.yaml           # Deployment + Service + bootstrap Job
    ├── trino.yaml             # Deployment + Service (file ConfigMaps mounted)
    ├── keycloak.yaml          # Deployment + Service (realm ConfigMap mounted)
    ├── spark.yaml             # Spark Connect Deployment + Service
    └── trino-read-job.yaml    # one-shot Job: quicksense-trino-client runs trino_read.py
```
