#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# kind-roundtrip.sh — end-to-end round-trip test against the kind cluster.
#
# Steps:
#   1. Spark write: kubectl exec into the Spark Connect pod and run spark_write.py
#      via spark-submit.  The script prints "SPARK WROTE" on success.
#   2. Trino read: apply the committed trino-read Job (idempotent — deletes any
#      prior run first), wait for completion, capture the logs, and grep for
#      "ROUNDTRIP OK".  Exits 1 (loudly) if the marker is absent.
#
# Prerequisites: the kind cluster must be up (task kind-up) and bootstrapped
#   (task kind-bootstrap) before running this script.
#
# Usage:
#   ./scripts/k8s/kind-roundtrip.sh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

kubectl config use-context "kind-quicksense" >/dev/null 2>&1 || { echo "kind cluster 'quicksense' not found — run 'task kind-up' first" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Step 1: Spark write via spark-submit inside the Spark Connect pod
# ---------------------------------------------------------------------------
echo "Running spark_write.py via kubectl exec..."
kubectl exec deploy/spark -- /opt/spark/bin/spark-submit /workspace/scripts/roundtrip/spark_write.py

# ---------------------------------------------------------------------------
# Step 2: Trino read — apply Job (quicksense-trino-client:latest), wait, capture logs
# The Job runs: python /workspace/scripts/roundtrip/trino_read.py
# ---------------------------------------------------------------------------
echo "Cleaning up any previous trino-read Job run..."
kubectl delete job trino-read --ignore-not-found

echo "Applying trino-read Job (quicksense-trino-client:latest runs trino_read.py)..."
kubectl apply -f deploy/k8s/base/trino-read-job.yaml

echo "Waiting for trino-read Job to complete (timeout 180s)..."
kubectl wait --for=condition=complete job/trino-read --timeout=180s || { echo "trino-read Job did not complete:" >&2; kubectl logs job/trino-read >&2 || true; exit 1; }

echo "Capturing trino-read logs..."
TRINO_LOGS="$(kubectl logs job/trino-read)"

# ---------------------------------------------------------------------------
# Step 3: Verify round-trip marker — trino_read.py prints "ROUNDTRIP OK"
# ---------------------------------------------------------------------------
if ! echo "${TRINO_LOGS}" | grep -q "ROUNDTRIP OK"; then
  echo "ERROR: ROUNDTRIP OK not found in trino_read.py output (quicksense-trino-client:latest)." >&2
  echo "${TRINO_LOGS}" >&2
  exit 1
fi

echo ""
echo "ROUNDTRIP COMPLETE"
echo "  Spark wrote data; trino_read.py (quicksense-trino-client:latest) read it back."
echo "  ROUNDTRIP OK confirmed."
