# shellcheck shell=bash
# SPDX-License-Identifier: Apache-2.0
# Shared bootstrap helpers — source this file, do not execute directly.
# No top-level execution; no set -euo pipefail at file scope (caller sets it).

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

ensure_polaris_admin_principal_role() {
  local token="$1"
  local mgmt_base="http://localhost:${POLARIS_PORT:-8181}/api/management/v1"
  local catalog="${POLARIS_CATALOG:-quicksense}"
  local role_name="admin"
  local pr_status
  local pr_file="/tmp/quicksense-polaris-principal-role.json"

  # Check whether the principal role already exists.
  pr_status="$(curl -s -o "${pr_file}" -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    "${mgmt_base}/principal-roles/${role_name}")"

  if [[ "${pr_status}" == "404" ]]; then
    # Create the principal role.
    pr_status="$(curl -s -o "${pr_file}" -w "%{http_code}" \
      -H "Authorization: Bearer ${token}" \
      -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
      -H "Content-Type: application/json" \
      -X POST \
      "${mgmt_base}/principal-roles" \
      -d "{\"principalRole\":{\"name\":\"${role_name}\"}}")"

    case "${pr_status}" in
      200|201|409)
        echo "Created Polaris principal role ${role_name}"
        ;;
      *)
        echo "Unexpected Polaris principal-roles create status ${pr_status}" >&2
        cat "${pr_file}" >&2 || true
        return 1
        ;;
    esac
  elif [[ "${pr_status}" == "200" ]]; then
    echo "Polaris principal role ${role_name} already exists"
  else
    echo "Unexpected Polaris principal-roles lookup status ${pr_status}" >&2
    cat "${pr_file}" >&2 || true
    return 1
  fi

  # Bind the principal role to catalog-role catalog_admin on the quicksense catalog.
  local bind_file="/tmp/quicksense-polaris-principal-role-bind.json"
  local bind_status
  bind_status="$(curl -s -o "${bind_file}" -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    -H "Content-Type: application/json" \
    -X PUT \
    "${mgmt_base}/principal-roles/${role_name}/catalog-roles/${catalog}" \
    -d '{"catalogRole":{"name":"catalog_admin"}}')"

  case "${bind_status}" in
    200|201|204|409)
      echo "Bound Polaris principal role ${role_name} -> catalog-roles/catalog_admin on ${catalog}"
      ;;
    *)
      echo "Unexpected Polaris principal-role bind status ${bind_status}" >&2
      cat "${bind_file}" >&2 || true
      return 1
      ;;
  esac
}

ensure_polaris_external_principal() {
  local token="$1"
  local mgmt_base="http://localhost:${POLARIS_PORT:-8181}/api/management/v1"
  local principal_name="service-account-quicksense-api"
  local p_file="/tmp/quicksense-polaris-external-principal.json"
  local p_status

  # Check whether the principal already exists.
  p_status="$(curl -s -o "${p_file}" -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    "${mgmt_base}/principals/${principal_name}")"

  if [[ "${p_status}" == "200" ]]; then
    echo "Polaris principal ${principal_name} already exists"
    return 0
  fi

  if [[ "${p_status}" != "404" ]]; then
    echo "Unexpected Polaris principal lookup status ${p_status}" >&2
    cat "${p_file}" >&2 || true
    return 1
  fi

  # Create the principal.
  p_status="$(curl -s -o "${p_file}" -w "%{http_code}" \
    -H "Authorization: Bearer ${token}" \
    -H "Polaris-Realm: ${POLARIS_REALM:-POLARIS}" \
    -H "Content-Type: application/json" \
    -X POST \
    "${mgmt_base}/principals" \
    -d "{\"principal\":{\"name\":\"${principal_name}\"}}")"

  case "${p_status}" in
    200|201|409)
      echo "Created Polaris principal ${principal_name}"
      ;;
    *)
      echo "Unexpected Polaris principal create status ${p_status}" >&2
      cat "${p_file}" >&2 || true
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
