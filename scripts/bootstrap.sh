#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ROOT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  cp "${ROOT_DIR}/.env.example" "${ENV_FILE}"
fi

set -a
source "${ENV_FILE}"
set +a

COMPOSE=(docker compose --env-file "${ENV_FILE}" -f "${ROOT_DIR}/docker/docker-compose.yml")

wait_for_http() {
  local name="$1"
  local url="$2"
  local retries="${3:-60}"

  for _ in $(seq 1 "${retries}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${name} at ${url}" >&2
  return 1
}

polaris_token() {
  curl --fail-with-body -s "http://localhost:${POLARIS_PORT:-8181}/api/catalog/v1/oauth/tokens" \
    --user "${POLARIS_CLIENT_ID:-root}:${POLARIS_CLIENT_SECRET:-s3cr3t}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    -d grant_type=client_credentials \
    -d scope=PRINCIPAL_ROLE:ALL |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])'
}

ensure_polaris_catalog() {
  local token="$1"
  local catalog="${POLARIS_CATALOG:-quicksense}"
  local base_url="http://localhost:${POLARIS_PORT:-8181}/api/management/v1/catalogs"
  local status

  status="$(curl -s -o /tmp/quicksense-polaris-catalog.json -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    "${base_url}/${catalog}")"

  if [[ "${status}" == "200" ]]; then
    echo "Polaris catalog ${catalog} already exists"
    return 0
  fi

  if [[ "${status}" != "404" ]]; then
    echo "Unexpected Polaris catalog lookup status ${status}" >&2
    cat /tmp/quicksense-polaris-catalog.json >&2 || true
    return 1
  fi

  local payload
  payload="$(python3 - <<'PY'
import json
import os

catalog = os.environ.get("POLARIS_CATALOG", "quicksense")
bucket = os.environ.get("MINIO_BUCKET", "warehouse")
payload = {
    "catalog": {
        "name": catalog,
        "type": "INTERNAL",
        "readOnly": False,
        "properties": {
            "default-base-location": f"s3://{bucket}/{catalog}",
        },
        "storageConfigInfo": {
            "storageType": "S3",
            "allowedLocations": [f"s3://{bucket}/{catalog}"],
            "endpoint": "http://minio:9000",
            "endpointInternal": "http://minio:9000",
            "pathStyleAccess": True,
            "region": "us-east-1",
            "stsUnavailable": True,
        },
    }
}
print(json.dumps(payload))
PY
)"

  curl --fail-with-body -sS \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    -H "Accept: application/json" \
    -H "Content-Type: application/json" \
    "${base_url}" \
    -d "${payload}" >/dev/null

  echo "Created Polaris catalog ${catalog}"
}

ensure_polaris_catalog_admin_grant() {
  local token="$1"
  local catalog="${POLARIS_CATALOG:-quicksense}"
  local role="catalog_admin"
  local grants_file="/tmp/quicksense-polaris-catalog-grants.json"
  local grants_url="http://localhost:${POLARIS_PORT:-8181}/api/management/v1/catalogs/${catalog}/catalog-roles/${role}/grants"
  local status

  status="$(curl -s -o "${grants_file}" -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    "${grants_url}")"

  if [[ "${status}" != "200" ]]; then
    echo "Unexpected Polaris catalog role grants lookup status ${status}" >&2
    cat "${grants_file}" >&2 || true
    return 1
  fi

  if python3 - "${grants_file}" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    grants = json.load(handle).get("grants", [])

raise SystemExit(
    0
    if any(
        grant.get("type") == "catalog"
        and grant.get("privilege") == "CATALOG_MANAGE_CONTENT"
        for grant in grants
    )
    else 1
)
PY
  then
    echo "Polaris catalog_admin already has CATALOG_MANAGE_CONTENT"
    return 0
  fi

  status="$(curl -s -o /tmp/quicksense-polaris-grant-create.json -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    -H "Content-Type: application/json" \
    -X PUT \
    "${grants_url}" \
    -d '{"grant":{"type":"catalog","privilege":"CATALOG_MANAGE_CONTENT"}}')"

  case "${status}" in
    200|201|204|409)
      echo "Granted CATALOG_MANAGE_CONTENT to Polaris catalog_admin"
      ;;
    *)
      echo "Unexpected Polaris grant create status ${status}" >&2
      cat /tmp/quicksense-polaris-grant-create.json >&2 || true
      return 1
      ;;
  esac
}

verify_keycloak() {
  local token_url="http://localhost:${KEYCLOAK_PORT:-8082}/realms/${KEYCLOAK_REALM:-quicksense}/protocol/openid-connect/token"
  curl --fail-with-body -sS "${token_url}" \
    -d grant_type=client_credentials \
    -d client_id="${KEYCLOAK_CLIENT_ID:-quicksense-api}" \
    -d client_secret="${KEYCLOAK_CLIENT_SECRET:-qs-api-secret}" |
    python3 -c 'import json,sys; assert json.load(sys.stdin)["access_token"]'

  echo "KEYCLOAK OK"
}

wait_for_http "Polaris" "http://localhost:${POLARIS_MANAGEMENT_PORT:-8182}/q/health"
wait_for_http "MinIO" "http://localhost:${MINIO_API_PORT:-9000}/minio/health/live"
wait_for_http "Trino" "http://localhost:${TRINO_PORT:-8080}/v1/info"
wait_for_http "Keycloak" "http://localhost:${KEYCLOAK_PORT:-8082}/realms/master"

"${COMPOSE[@]}" run --rm minio-mc

token="$(polaris_token)"
ensure_polaris_catalog "${token}"
ensure_polaris_catalog_admin_grant "${token}"
verify_keycloak

echo "BOOTSTRAP OK"
