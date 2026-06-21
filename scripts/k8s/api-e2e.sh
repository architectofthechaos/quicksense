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
#   6. Resolve the operator-created Spark Connect Service name.
#   7. Run spark_write.py as a Kubernetes Job using quicksense-spark:latest.
#   8. Run trino_read.py as a Kubernetes Job using quicksense-trino-client:latest.
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
# NAMESPACE NOTE:
#   The API Deployment, SparkConnect CRs, and the base stack (polaris/minio/trino/
#   keycloak/postgres) all run in the `default` namespace.  Co-location is required
#   so SparkConnect driver/executor pods resolve short-name DNS (e.g. "polaris",
#   "minio") — Polaris advertises short-name REST endpoints, so cross-namespace
#   pods fail with UnknownHostException.  Live-verified: ROUNDTRIP OK.
#
# OPERATOR CONNECT SERVICE NOTE (RECONCILED-AT-LIVE-RUN):
#   The Spark Operator creates a Service and pod for each SparkConnect CR in
#   `default`. The operator names them "<cr-name>-server" on port 15002
#   (verified live). At live run, inspect with:
#     kubectl get svc -n default
#   and set CONNECT_SVC_OVERRIDE=<actual-name> in the environment if needed.
#   The round-trip client (spark_write.py in SC_REMOTE mode) runs in the
#   quicksense-spark image so it uses the same pinned Spark/Python dependencies.

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
KEYCLOAK_ISSUER_HOST="${KEYCLOAK_ISSUER_HOST:-keycloak:${KEYCLOAK_PORT}}"
TRINO_PORT="${TRINO_PORT:-8080}"
API_NS="default"
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
  -H "Host: ${KEYCLOAK_ISSUER_HOST}" \
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
#    The API GET /v1/clusters/{id} returns {"ready":true,"phase":"Ready"}
#    when the operator reports .status.state=Ready.
# ---------------------------------------------------------------------------
echo "==> Waiting for cluster '${CLUSTER_ID}' (CR: ${CR_NAME}) to become Ready (up to 300 s)..."

# The operator creates a Service named "<cr-name>-server" on port 15002.
CONNECT_SVC="${CONNECT_SVC_OVERRIDE:-${CR_NAME}-server}"

# API poll: GET /v1/clusters/{id} until ready == true or phase is Ready/Running.
# SparkConnect CRs expose readiness as .status.state, not condition=Ready.
READY=false
for _ in $(seq 1 60); do
  STATUS_JSON="$(curl -fsS "${API}/v1/clusters/${CLUSTER_ID}" \
    -H "Authorization: Bearer ${TOKEN}" 2>/dev/null || echo '{}')"
  IS_READY="$(python3 -c 'import json,sys; d=json.load(sys.stdin); print("true" if d.get("ready") or d.get("phase","") in ("Ready","Running") else "false")' <<<"${STATUS_JSON}" 2>/dev/null || echo 'false')"
  if [[ "${IS_READY}" == "true" ]]; then
    READY=true
    break
  fi
  CR_STATE="$(kubectl -n "${API_NS}" get sparkconnect "${CR_NAME}" -o jsonpath='{.status.state}' 2>/dev/null || true)"
  if [[ "${CR_STATE}" == "Ready" ]]; then
    READY=true
    break
  fi
  sleep 5
done

if [[ "${READY}" != "true" ]]; then
  echo "WARNING: cluster did not reach Ready state within timeout; proceeding anyway." >&2
fi

# ---------------------------------------------------------------------------
# 8. Wait for the Spark Connect server pod and run spark_write.py in-cluster.
# ---------------------------------------------------------------------------
echo "==> Waiting for Spark Connect server pod '${CONNECT_SVC}' to be Ready..."
kubectl wait --for=condition=Ready "pod/${CONNECT_SVC}" -n "${API_NS}" --timeout=120s

SPARK_WRITE_JOB="qs-api-e2e-spark-write"
echo "==> Running spark_write.py via SC_REMOTE=sc://${CONNECT_SVC}:15002..."
kubectl delete job "${SPARK_WRITE_JOB}" -n "${API_NS}" --ignore-not-found
cat <<EOF | kubectl apply -n "${API_NS}" -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${SPARK_WRITE_JOB}
spec:
  backoffLimit: 0
  ttlSecondsAfterFinished: 600
  template:
    spec:
      restartPolicy: Never
      containers:
        - name: spark-write
          image: quicksense-spark:latest
          imagePullPolicy: IfNotPresent
          command:
            - python3
            - /workspace/scripts/roundtrip/spark_write.py
          env:
            - name: SC_REMOTE
              value: "sc://${CONNECT_SVC}:15002"
            - name: PYTHONPATH
              value: "/opt/spark/python:/opt/spark/python/lib/py4j-0.10.9.9-src.zip"
          volumeMounts:
            - name: roundtrip-scripts
              mountPath: /workspace/scripts/roundtrip
              readOnly: true
      volumes:
        - name: roundtrip-scripts
          configMap:
            name: roundtrip-scripts
EOF
kubectl wait --for=condition=complete "job/${SPARK_WRITE_JOB}" -n "${API_NS}" --timeout=300s || {
  echo "spark_write Job did not complete:" >&2
  kubectl logs "job/${SPARK_WRITE_JOB}" -n "${API_NS}" >&2 || true
  exit 1
}
kubectl logs "job/${SPARK_WRITE_JOB}" -n "${API_NS}"

# ---------------------------------------------------------------------------
# 9. Run trino_read.py in-cluster and verify ROUNDTRIP OK.
# ---------------------------------------------------------------------------
echo "==> Waiting for Trino to be Ready..."
kubectl rollout status deploy/trino -n "${API_NS}" --timeout=180s
kubectl wait --for=condition=Ready pod -l app=trino -n "${API_NS}" --timeout=180s

echo "==> Running trino_read.py via Kubernetes Job..."
kubectl delete job trino-read -n "${API_NS}" --ignore-not-found
kubectl apply -f deploy/k8s/base/trino-read-job.yaml
kubectl wait --for=condition=complete job/trino-read -n "${API_NS}" --timeout=180s || {
  echo "trino-read Job did not complete:" >&2
  kubectl logs job/trino-read -n "${API_NS}" >&2 || true
  exit 1
}
TRINO_LOGS="$(kubectl logs job/trino-read -n "${API_NS}")"
echo "${TRINO_LOGS}"
if ! echo "${TRINO_LOGS}" | grep -q "ROUNDTRIP OK"; then
  echo "ERROR: ROUNDTRIP OK not found in trino_read.py output." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
echo "API E2E OK"
