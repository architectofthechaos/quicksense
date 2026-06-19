# deploy/k8s/config — .env → ConfigMap / Secret mapping

`scripts/k8s/kind-up.sh` generates all Kubernetes configuration objects at cluster-apply time
from `.env` and the existing source files. Nothing is hand-duplicated from the Compose dev tier.

---

## ConfigMap `qs-config`

Created with `kubectl create configmap qs-config --from-env-file=.env`.

Every key in `.env` becomes an entry in this ConfigMap. All pods mount it via `envFrom:
configMapRef: qs-config`.

## Secret `qs-secrets`

Created with `kubectl create secret generic qs-secrets --from-literal=KEY=VALUE ...` for exactly
six sensitive keys:

| Key | Description |
| --- | --- |
| `POSTGRES_PASSWORD` | Postgres superuser password |
| `POLARIS_CLIENT_SECRET` | Polaris OAuth2 client secret |
| `MINIO_ROOT_PASSWORD` | MinIO root password |
| `KEYCLOAK_ADMIN_PASSWORD` | Keycloak admin console password |
| `KEYCLOAK_CLIENT_SECRET` | Keycloak `quicksense-api` client secret |
| `KEYCLOAK_TEST_PASSWORD` | Keycloak test user (`qsuser`) password |

All pods also mount it via `envFrom: secretRef: qs-secrets`, listed after `configMapRef: qs-config`
so the Secret values win for these six keys (later `envFrom` entries take precedence).

## Polaris dotted feature-flag keys

Polaris 1.5 Quarkus feature flags use dotted keys such as
`polaris.features."ALLOW_INSECURE_STORAGE_TYPES"`. These cannot round-trip through a `.env` file
(dotted keys are not valid shell variable names). They are therefore set as literal `env:` entries
directly in `deploy/k8s/base/polaris.yaml` rather than flowing through `.env` → `qs-config`.

The three keys set this way in `polaris.yaml`:

- `polaris.features."ALLOW_INSECURE_STORAGE_TYPES"` = `true`
- `polaris.features."ALLOW_SETTING_S3_ENDPOINTS"` = `true`
- `polaris.features."SUPPORTED_CATALOG_STORAGE_TYPES"` = `["FILE","S3","GCS","AZURE"]`

These are local-dev-only flags and are not expected to change per environment, so embedding them
in the manifest is intentional.

## File-based ConfigMaps

Four additional ConfigMaps are generated from the same source files used by Docker Compose:

| ConfigMap | kubectl flag | Source path(s) |
| --- | --- | --- |
| `trino-etc` | `--from-file` | `docker/trino/etc/{config,node,jvm,log}.properties` |
| `trino-catalog` | `--from-file` | `docker/trino/etc/catalog/iceberg.properties` |
| `keycloak-realm` | `--from-file` | `docker/keycloak/realm-quicksense.json` |
| `roundtrip-scripts` | `--from-file` | `scripts/roundtrip/spark_write.py`, `trino_read.py` |

Editing any of those source files and re-running `task kind-up` regenerates the ConfigMaps
idempotently (via `--dry-run=client -o yaml | kubectl apply`).
