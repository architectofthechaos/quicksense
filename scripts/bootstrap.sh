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

# shellcheck source=scripts/lib/bootstrap-common.sh
source "${ROOT_DIR}/scripts/lib/bootstrap-common.sh"

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
