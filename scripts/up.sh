#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT_DIR}"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

compose=(docker compose --env-file .env -f docker/docker-compose.yml)

"${compose[@]}" up -d --build --wait postgres

set +e
"${compose[@]}" run --rm --no-deps polaris-bootstrap
bootstrap_status=$?
set -e

if [[ "${bootstrap_status}" -ne 0 && "${bootstrap_status}" -ne 3 ]]; then
  exit "${bootstrap_status}"
fi

if [[ "${bootstrap_status}" -eq 3 ]]; then
  echo "Polaris database already bootstrapped"
fi

"${compose[@]}" up -d --build --wait minio polaris spark trino keycloak
