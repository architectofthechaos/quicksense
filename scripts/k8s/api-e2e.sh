#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# api-e2e.sh — end-to-end smoke test for the QuickSense API on kind.
#
# Flow:
#   1. Obtain a Keycloak client_credentials token (requires keycloak port-forward).
#   2. POST /v1/catalogs   — create (or tolerate 409) the "quicksense" catalog.
#   3. POST /v1/catalogs/quicksense/namespaces/demo/tables — create the table.
#   4. POST /v1/clusters   — create a SparkConnect cluster, capture id.
#   5. Wait for the cluster to become Ready (kubectl wait + API poll).
#   6. Resolve the operator-created Spark Connect Service name, port-forward it.
#   7. SC_REMOTE=sc://localhost:15002 python3 spark_write.py
#   8. TRINO_HOST=localhost ... python3 trino_read.py
#   9. echo "API E2E OK"
#
# Prerequisites (must already be running before this script):
#   - kind cluster "quicksense"
#   - task kind-up && task kind-bootstrap && task operator-install
#   - task api-build && task api-run    (quicksense-api Deployment ready)
#   - Port-forwards for Keycloak and Trino (see below or run manually):
#       kubectl port-forward svc/keycloak ${KEYCLOAK_PORT}:${KEYCLOAK_PORT} &
#       kubectl port-forward svc/trino    ${TRINO_PORT}:${TRINO_PORT} &
#
# OPERATOR CONNECT SERVICE NOTE (RECONCILED-AT-LIVE-RUN):
#   The Spark Operator creates a Service for each SparkConnect CR.
#   The exact name depends on the operator version and CR name.
#   Sensible default guess: "<cr-name>-connect" (e.g. "e2e-connect").
#   At live run, inspect with:
#     kubectl get svc -n quicksense
#   and set CONNECT_SVC_OVERRIDE=<actual-name> in the environment if needed.
#   The script auto-discovers by listing Services that match the cluster name.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Load environment
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  echo "ERROR: .env not found — run 'cp .env.example .env' first" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# Verify we are pointed at the right cluster.
kubectl config use-context kind-quicksense >/dev/null 2>&1 || {
  echo "ERROR: kubectl context 'kind-quicksense' not found — run 'task kind-up' first" >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Port-forward tracking — everything killed on EXIT.
# ---------------------------------------------------------------------------
PF_PIDS=()

cleanup() {
  if [[ ${#PF_PIDS[@]} -gt 0 ]]; then
    kill "${PF_PIDS[@]}" 2>/dev/null || true
  fi
}
trap cleanup EXIT

# ---------------------------------------------------------------------------
# Helper: wait for an HTTP endpoint to return a non-error response.
# ---------------------------------------------------------------------------
wait_for_http_local() {
  local name="$1"
  local url="$2"
  local retries="${3:-30}"
  local i
  for i in $(seq 1 "${retries}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  echo "Timed out waiting for ${name} at ${url}" >&2
  return 1
}

# ---------------------------------------------------------------------------
# Defaults (from .env; override by setting env vars before calling the script).
# ---------------------------------------------------------------------------
KEYCLOAK_PORT="${KEYCLOAK_PORT:-8082}"
KEYCLOAK_REALM="${KEYCLOAK_REALM:-quicksense}"
KEYCLOAK_CLIENT_ID="${KEYCLOAK_CLIENT_ID:-quicksense-api}"
KEYCLOAK_CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET:-qs-api-secret}"
TRINO_PORT="${TRINO_PORT:-8080}"
API_NS="quicksense"
API_SVC="quicksense-api"
API_LOCAL_PORT="8090"

# ---------------------------------------------------------------------------
# 1. Port-forward Keycloak so we can obtain a token on localhost.
# ---------------------------------------------------------------------------
echo "==> Port-forwarding Keycloak on ${KEYCLOAK_PORT}..."
kubectl port-forward "svc/keycloak" "${KEYCLOAK_PORT}:${KEYCLOAK_PORT}" &
PF_PIDS+=($!)
wait_for_http_local "Keycloak" "http://localhost:${KEYCLOAK_PORT}/realms/master"

# ---------------------------------------------------------------------------
# 2. Obtain a Keycloak client_credentials token.
# ---------------------------------------------------------------------------
echo "==> Obtaining Keycloak token..."
TOKEN_RESPONSE="$(curl --fail-with-body -sS \
  "http://localhost:${KEYCLOAK_PORT}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token" \
  -d grant_type=client_credentials \
  -d client_id="${KEYCLOAK_CLIENT_ID}" \
  -d client_secret="${KEYCLOAK_CLIENT_SECRET}")"

TOKEN="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])' <<<"${TOKEN_RESPONSE}")"
echo "Token obtained (length=${#TOKEN})."

# ---------------------------------------------------------------------------
# 3. Port-forward the API Service.
# ---------------------------------------------------------------------------
echo "==> Port-forwarding API service on ${API_LOCAL_PORT}..."
kubectl port-forward "svc/${API_SVC}" "${API_LOCAL_PORT}:${API_LOCAL_PORT}" -n "${API_NS}" &
PF_PIDS+=($!)

API="http://localhost:${API_LOCAL_PORT}"
wait_for_http_local "API /healthz" "${API}/healthz"

# ---------------------------------------------------------------------------
# 4. POST /v1/catalogs — create the "quicksense" catalog (tolerate 409).
# ---------------------------------------------------------------------------
echo "==> Creating catalog 'quicksense'..."
CATALOG_STATUS="$(curl -s -o /tmp/qs-e2e-catalog.json -w "%{http_code}" \
  -X POST "${API}/v1/catalogs" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "quicksense",
    "storageType": "S3",
    "bucket": "warehouse",
    "s3Endpoint": "http://minio:9000",
    "region": "us-east-1"
  }')"

case "${CATALOG_STATUS}" in
  200|201|409)
    echo "Catalog ready (status=${CATALOG_STATUS})."
    ;;
  *)
    echo "ERROR: POST /v1/catalogs returned ${CATALOG_STATUS}" >&2
    cat /tmp/qs-e2e-catalog.json >&2 || true
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 5. POST /v1/catalogs/quicksense/namespaces/demo/tables (tolerate 409).
# ---------------------------------------------------------------------------
echo "==> Creating table 'quicksense.demo.events'..."
TABLE_STATUS="$(curl -s -o /tmp/qs-e2e-table.json -w "%{http_code}" \
  -X POST "${API}/v1/catalogs/quicksense/namespaces/demo/tables" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "events",
    "schema": {
      "fields": [
        {"id": 1, "name": "id",   "type": "long",      "required": true},
        {"id": 2, "name": "name", "type": "string",    "required": true},
        {"id": 3, "name": "ts",   "type": "timestamp", "required": true}
      ]
    }
  }')"

case "${TABLE_STATUS}" in
  200|201|409)
    echo "Table ready (status=${TABLE_STATUS})."
    ;;
  *)
    echo "ERROR: POST /v1/catalogs/quicksense/namespaces/demo/tables returned ${TABLE_STATUS}" >&2
    cat /tmp/qs-e2e-table.json >&2 || true
    exit 1
    ;;
esac

# ---------------------------------------------------------------------------
# 6. POST /v1/clusters — create a SparkConnect cluster, capture id.
# ---------------------------------------------------------------------------
echo "==> Creating cluster 'e2e'..."
CLUSTER_RESPONSE="$(curl --fail-with-body -sS \
  -X POST "${API}/v1/clusters" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"name":"e2e"}')"

CLUSTER_ID="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])' <<<"${CLUSTER_RESPONSE}")"
CR_NAME="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["cr_name"])' <<<"${CLUSTER_RESPONSE}")"
echo "Cluster created (id=${CLUSTER_ID}, cr_name=${CR_NAME})."

# ---------------------------------------------------------------------------
# 7. Wait for the cluster to become Ready.
#    The API GET /v1/clusters/{id} returns {"status":"ready"} when live.
#    In parallel, wait on the SparkConnect CR via kubectl.
# ---------------------------------------------------------------------------
echo "==> Waiting for cluster '${CLUSTER_ID}' (CR: ${CR_NAME}) to become Ready (up to 300 s)..."

# The operator creates a Service named "<cr-name>-server" on port 15002.
CONNECT_SVC="${CONNECT_SVC_OVERRIDE:-${CR_NAME}-server}"

# Wait on the CR if the SparkConnect CRD is installed; fall back to API poll.
if kubectl get crd sparkconnects.sparkoperator.k8s.io >/dev/null 2>&1; then
  kubectl -n "${API_NS}" wait \
    --for=condition=Ready \
    "sparkconnect/${CR_NAME}" \
    --timeout=300s || true  # non-fatal; API poll below is the authoritative check
fi

# API poll: GET /v1/clusters/{id} until ready == true or phase == "Running".
READY=false
for _ in $(seq 1 60); do
  STATUS_JSON="$(curl -fsS "${API}/v1/clusters/${CLUSTER_ID}" \
    -H "Authorization: Bearer ${TOKEN}" 2>/dev/null || echo '{}')"
  IS_READY="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("true" if d.get("ready") or d.get("phase","")=="Running" else "false")' <<<"${STATUS_JSON}" 2>/dev/null || echo 'false')"
  if [[ "${IS_READY}" == "true" ]]; then
    READY=true
    break
  fi
  sleep 5
done

if [[ "${READY}" != "true" ]]; then
  echo "WARNING: cluster did not reach Ready state within timeout; proceeding anyway." >&2
fi

# ---------------------------------------------------------------------------
# 8. Port-forward the Spark Connect Service.
# ---------------------------------------------------------------------------
echo "==> Port-forwarding Spark Connect service '${CONNECT_SVC}' on 15002..."
kubectl port-forward "svc/${CONNECT_SVC}" 15002:15002 -n "${API_NS}" &
PF_PIDS+=($!)
sleep 3  # give the port-forward a moment to establish

# ---------------------------------------------------------------------------
# 9. Run spark_write.py via the operator-managed Spark Connect cluster.
# ---------------------------------------------------------------------------
echo "==> Running spark_write.py via SC_REMOTE=sc://localhost:15002..."
SC_REMOTE=sc://localhost:15002 python3 "${ROOT_DIR}/scripts/roundtrip/spark_write.py"

# ---------------------------------------------------------------------------
# 10. Port-forward Trino and run trino_read.py.
# ---------------------------------------------------------------------------
echo "==> Port-forwarding Trino on ${TRINO_PORT}..."
kubectl port-forward svc/trino "${TRINO_PORT}:${TRINO_PORT}" &
PF_PIDS+=($!)
wait_for_http_local "Trino" "http://localhost:${TRINO_PORT}/v1/info"

echo "==> Running trino_read.py..."
TRINO_HOST=localhost TRINO_PORT="${TRINO_PORT}" python3 "${ROOT_DIR}/scripts/roundtrip/trino_read.py"

# ---------------------------------------------------------------------------
echo "API E2E OK"
