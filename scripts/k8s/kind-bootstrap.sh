#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
# Bootstrap the kind cluster: bucket + Polaris catalog + grants + Keycloak verify.
# Reuses shared helpers from scripts/lib/bootstrap-common.sh via port-forwards
# so that all localhost:${PORT} URLs in the helpers resolve to the cluster.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
fi

set -a
source "${ENV_FILE}"
set +a

# shellcheck source=scripts/lib/bootstrap-common.sh
source "${ROOT_DIR}/scripts/lib/bootstrap-common.sh"

kubectl config use-context "kind-quicksense" >/dev/null 2>&1 || { echo "kind cluster 'quicksense' not found — run 'task kind-up' first" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Start port-forwards so helpers' localhost:${PORT} URLs reach the cluster.
# ---------------------------------------------------------------------------

kubectl port-forward svc/polaris 8181:8181 8182:8182 &
PF_POLARIS=$!

kubectl port-forward svc/minio 9000:9000 &
PF_MINIO=$!

kubectl port-forward svc/keycloak 8082:8082 &
PF_KEYCLOAK=$!

kubectl port-forward svc/trino 8080:8080 &
PF_TRINO=$!

PF_PIDS=("${PF_POLARIS}" "${PF_MINIO}" "${PF_KEYCLOAK}" "${PF_TRINO}")

trap 'kill "${PF_PIDS[@]}" 2>/dev/null || true' EXIT

# Wait until all services are reachable through the port-forwards.
wait_for_http "Polaris"   "http://localhost:${POLARIS_MANAGEMENT_PORT:-8182}/q/health"
wait_for_http "MinIO"     "http://localhost:${MINIO_API_PORT:-9000}/minio/health/live"
wait_for_http "Trino"     "http://localhost:${TRINO_PORT:-8080}/v1/info"
wait_for_http "Keycloak"  "http://localhost:${KEYCLOAK_PORT:-8082}/realms/master"

# ---------------------------------------------------------------------------
# Create the MinIO bucket via a one-shot mc pod.
# Inside the pod, minio:9000 resolves via cluster DNS — no port-forward needed.
# ---------------------------------------------------------------------------

kubectl run qs-mc-bucket \
  --rm -i --restart=Never \
  --image=minio/mc:RELEASE.2025-08-13T08-35-41Z \
  --env="MINIO_ROOT_USER=${MINIO_ROOT_USER}" \
  --env="MINIO_ROOT_PASSWORD=${MINIO_ROOT_PASSWORD}" \
  --env="MINIO_BUCKET=${MINIO_BUCKET:-warehouse}" \
  --command -- /bin/sh -c 'mc alias set local http://minio:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" && mc mb --ignore-existing local/"$MINIO_BUCKET"'

# ---------------------------------------------------------------------------
# Polaris catalog + grants + Keycloak — identical to Compose bootstrap.
# ---------------------------------------------------------------------------

token="$(polaris_token)"
ensure_polaris_catalog "${token}"
ensure_polaris_catalog_admin_grant "${token}"
ensure_polaris_admin_principal_role "${token}"
ensure_polaris_external_principal "${token}"
verify_keycloak

echo "BOOTSTRAP OK"
