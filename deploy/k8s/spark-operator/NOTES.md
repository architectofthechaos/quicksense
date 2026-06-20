# Spark Operator — Air-Gapped Installation Notes

## Chart details

| Item            | Value                                        |
|-----------------|----------------------------------------------|
| Chart name      | spark-operator                               |
| Chart version   | **2.5.1**                                    |
| Helm repo URL   | https://kubeflow.github.io/spark-operator    |
| Operator image  | `ghcr.io/kubeflow/spark-operator/controller:2.5.1` |

> **SparkConnect CRD note:** the `sparkconnects.sparkoperator.k8s.io` CRD ships
> with chart >= 2.5.1.  Its presence in the cluster is verified live in task B17
> (`kubectl get crd sparkconnects.sparkoperator.k8s.io`).

---

## Mirroring the chart (air-gapped)

```bash
# Add the repo (network access required once, then mirror offline)
helm repo add spark-operator https://kubeflow.github.io/spark-operator
helm repo update spark-operator

# Pull the chart tarball for offline distribution
helm pull spark-operator/spark-operator --version 2.5.1
# Produces: spark-operator-2.5.1.tgz
```

---

## Mirroring the operator image (air-gapped / kind)

```bash
# Pull the controller image while you have network access
docker pull ghcr.io/kubeflow/spark-operator/controller:2.5.1

# Load into the local kind cluster for offline use
kind load docker-image ghcr.io/kubeflow/spark-operator/controller:2.5.1 \
  --name quicksense
```

---

## Live install

Use `task operator-install` which runs `scripts/k8s/operator-install.sh`.
The script:
1. Pins the context to `kind-quicksense` (cluster name: `quicksense`).
2. Adds the Helm repo and updates it.
3. Creates the `quicksense` namespace (idempotent) — this is where the operator
   watches for SparkApplication / SparkConnect CRs.
4. Runs `helm upgrade --install` with `--version 2.5.1` and `-f values.yaml`.
5. Verifies the `sparkconnects.sparkoperator.k8s.io` CRD exists.

---

## Namespace layout

| Namespace        | Purpose                                          |
|------------------|--------------------------------------------------|
| `spark-operator` | Operator controller pod lives here               |
| `quicksense`     | SparkConnect / SparkApplication CRs created here |

---

## Key assumptions (reconciled at live install)

- The chart 2.5.1 value keys `image.registry`, `image.repository`, `image.tag`,
  `spark.jobNamespaces`, `webhook.enable`, and `rbac.create` match the actual
  chart defaults.  If the live install discovers key-name drift, update
  `values.yaml` accordingly.
- The `SparkConnect` CRD is bundled in the chart tarball and installed
  automatically by `helm upgrade --install`.
