#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# kind-up.sh — bring up the full quicksense stack on a local kind cluster.
#
# Prerequisites:
#   - kind, kubectl, docker must be installed and on PATH.
#   - quicksense-spark:latest must be built ("task up" builds it via docker
#     compose --build; the kind tier reuses the exact same local image).
#   - quicksense-trino-client:latest must be built (produced by task up).
#
# Usage:
#   ./scripts/k8s/kind-up.sh
#
# Idempotent: safe to re-run; it skips cluster creation if the cluster already
# exists and uses --dry-run=client | kubectl apply for all ConfigMaps/Secrets.
#
# Note on envFrom ordering: manifests list configMapRef: qs-config BEFORE
# secretRef: qs-secrets.  The later secretRef wins at runtime, so the sensitive
# dev passwords that are also present in qs-config (via --from-env-file) are
# silently overridden by the Secret values — the expected behaviour for the
# local dev tier.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Bootstrap .env
# ---------------------------------------------------------------------------
if [[ ! -f .env ]]; then
  cp .env.example .env
fi

set -a
# shellcheck disable=SC1091
source .env
set +a

# ---------------------------------------------------------------------------
# Pre-flight: the Spark image must exist locally (kind cannot pull it from a
# registry because it is a locally-built image).
# ---------------------------------------------------------------------------
if ! docker image inspect quicksense-spark:latest >/dev/null 2>&1; then
  echo "ERROR: quicksense-spark:latest not found." >&2
  echo "Build the Spark image first: run 'task up'" >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Create kind cluster (skip if already running)
# ---------------------------------------------------------------------------
if ! kind get clusters | grep -qx quicksense; then
  echo "Creating kind cluster 'quicksense'..."
  kind create cluster --name quicksense --config deploy/k8s/kind-cluster.yaml
else
  echo "Kind cluster 'quicksense' already exists — skipping creation."
fi

kubectl config use-context "kind-quicksense" >/dev/null

# ---------------------------------------------------------------------------
# Load locally-built images into the cluster so pods can pull them with
# imagePullPolicy: IfNotPresent without reaching a registry.
# ---------------------------------------------------------------------------
echo "Loading quicksense-spark:latest into kind..."
kind load docker-image quicksense-spark:latest --name quicksense

echo "Loading quicksense-trino-client:latest into kind..."
kind load docker-image quicksense-trino-client:latest --name quicksense

# ---------------------------------------------------------------------------
# Generate ConfigMaps / Secrets idempotently
# Each command uses --dry-run=client -o yaml piped to kubectl apply so re-runs
# are safe (apply is a no-op when content is unchanged).
# ---------------------------------------------------------------------------

echo "Applying ConfigMap qs-config from .env..."
kubectl create configmap qs-config \
  --from-env-file=.env \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying Secret qs-secrets..."
# Only the six sensitive keys go into the Secret; everything else lives in
# qs-config (via --from-env-file above).  At runtime the secretRef wins over
# the configMapRef for these keys — see envFrom ordering note at the top.
kubectl create secret generic qs-secrets \
  --from-literal=POSTGRES_PASSWORD="${POSTGRES_PASSWORD}" \
  --from-literal=POLARIS_CLIENT_SECRET="${POLARIS_CLIENT_SECRET}" \
  --from-literal=MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD}" \
  --from-literal=KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD}" \
  --from-literal=KEYCLOAK_CLIENT_SECRET="${KEYCLOAK_CLIENT_SECRET}" \
  --from-literal=KEYCLOAK_TEST_PASSWORD="${KEYCLOAK_TEST_PASSWORD}" \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying ConfigMap trino-etc..."
kubectl create configmap trino-etc \
  --from-file=config.properties=docker/trino/etc/config.properties \
  --from-file=node.properties=docker/trino/etc/node.properties \
  --from-file=jvm.config=docker/trino/etc/jvm.config \
  --from-file=log.properties=docker/trino/etc/log.properties \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying ConfigMap trino-catalog..."
kubectl create configmap trino-catalog \
  --from-file=iceberg.properties=docker/trino/etc/catalog/iceberg.properties \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying ConfigMap keycloak-realm..."
kubectl create configmap keycloak-realm \
  --from-file=realm-quicksense.json=docker/keycloak/realm-quicksense.json \
  --dry-run=client -o yaml | kubectl apply -f -

echo "Applying ConfigMap roundtrip-scripts..."
kubectl create configmap roundtrip-scripts \
  --from-file=spark_write.py=scripts/roundtrip/spark_write.py \
  --from-file=trino_read.py=scripts/roundtrip/trino_read.py \
  --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# Apply manifests in dependency order and wait for readiness
# ---------------------------------------------------------------------------

echo "Deploying postgres..."
kubectl apply -f deploy/k8s/base/postgres.yaml
kubectl rollout status deploy/postgres --timeout=180s

# Deploy Keycloak before Polaris: Polaris performs OIDC discovery against the
# Keycloak issuer URL at startup (mixed mode).  Deploying Keycloak first lets
# the OIDC tenant initialize during Polaris startup rather than lazily on first
# request.  Postgres must still be first because the polaris-bootstrap Job
# needs it.
echo "Deploying keycloak..."
kubectl apply -f deploy/k8s/base/keycloak.yaml
kubectl rollout status deploy/keycloak --timeout=180s

echo "Deploying polaris..."
kubectl apply -f deploy/k8s/base/polaris.yaml
kubectl wait --for=condition=complete job/polaris-bootstrap --timeout=180s
kubectl rollout status deploy/polaris --timeout=180s

echo "Deploying minio..."
kubectl apply -f deploy/k8s/base/minio.yaml
kubectl rollout status deploy/minio --timeout=180s

# Note: deploy/k8s/base/spark.yaml is created in task A9; the reference here
# is intentional — the contract test is static and passes before that file
# lands; at runtime A9 must complete before this section succeeds.
echo "Deploying spark..."
kubectl apply -f deploy/k8s/base/spark.yaml
kubectl rollout status deploy/spark --timeout=180s

echo "Deploying trino..."
kubectl apply -f deploy/k8s/base/trino.yaml
kubectl rollout status deploy/trino --timeout=180s

echo ""
echo "KIND STACK UP"
echo "  Polaris:  http://localhost:8181"
echo "  MinIO:    http://localhost:9000  (console: :9001)"
echo "  Trino:    http://localhost:8080"
echo "  Keycloak: http://localhost:8082"
echo "  Spark UI: http://localhost:4040"
