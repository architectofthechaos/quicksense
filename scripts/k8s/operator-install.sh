#!/usr/bin/env bash
# SPDX-License-Identifier: Apache-2.0
#
# operator-install.sh — install the kubeflow Spark Operator via Helm (pinned).
#
# Chart:   spark-operator 2.4.0 (https://kubeflow.github.io/spark-operator)
# Operator namespace: spark-operator
# Watched namespace:  quicksense (SparkConnect / SparkApplication CRs)
#
# Air-gapped note: mirror the chart and image before running offline:
#   helm pull spark-operator/spark-operator --version 2.4.0
#   docker pull ghcr.io/kubeflow/spark-operator/controller:2.4.0
#   kind load docker-image ghcr.io/kubeflow/spark-operator/controller:2.4.0 \
#     --name quicksense
#
# Prerequisites: kind cluster 'quicksense' running ('task kind-up').
#
# Idempotent: helm upgrade --install is safe to re-run.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "${ROOT_DIR}"

# ---------------------------------------------------------------------------
# Context guard — must be connected to the quicksense kind cluster
# ---------------------------------------------------------------------------
kubectl config use-context "kind-quicksense" >/dev/null 2>&1 || {
  echo "ERROR: kubectl context 'kind-quicksense' not found." >&2
  echo "Run 'task kind-up' first." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Helm repo
# ---------------------------------------------------------------------------
echo "Adding / updating spark-operator Helm repo..."
helm repo add spark-operator https://kubeflow.github.io/spark-operator
helm repo update spark-operator

# ---------------------------------------------------------------------------
# Ensure the watched namespace exists (idempotent)
# The Go API creates SparkConnect CRs in this namespace.
# ---------------------------------------------------------------------------
echo "Ensuring namespace 'quicksense' exists..."
kubectl create namespace quicksense --dry-run=client -o yaml | kubectl apply -f -

# ---------------------------------------------------------------------------
# Install / upgrade the operator
# ---------------------------------------------------------------------------
echo "Installing spark-operator chart 2.4.0 into namespace 'spark-operator'..."
helm upgrade --install spark-operator spark-operator/spark-operator \
  --version 2.4.0 \
  --namespace spark-operator \
  --create-namespace \
  -f "${ROOT_DIR}/deploy/k8s/spark-operator/values.yaml" \
  --wait

# ---------------------------------------------------------------------------
# Smoke-check: verify the SparkConnect CRD landed
# (SparkConnect CRD ships with chart >= 2.4.0; verified live in task B17)
# ---------------------------------------------------------------------------
echo "Verifying SparkConnect CRD..."
kubectl get crd sparkconnects.sparkoperator.k8s.io

echo "OPERATOR INSTALL OK"
