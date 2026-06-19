# SPDX-License-Identifier: Apache-2.0
"""Static contract tests for SPEC-001 infrastructure deliverables."""

from pathlib import Path
import re
import pytest
import yaml


ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def test_required_files_exist():
    required = [
        "Taskfile.yml",
        "README.md",
        "LICENSE",
        ".gitignore",
        ".env.example",
        "docker/docker-compose.yml",
        "docker/polaris/README.md",
        "docker/minio/README.md",
        "docker/spark/Dockerfile",
        "docker/spark/spark-defaults.conf",
        "docker/spark/render-spark-defaults.sh",
        "docker/trino/etc/config.properties",
        "docker/trino/etc/catalog/iceberg.properties",
        "docker/keycloak/realm-quicksense.json",
        "scripts/up.sh",
        "scripts/bootstrap.sh",
        "scripts/roundtrip/spark_write.py",
        "scripts/roundtrip/trino_read.py",
        "api/README.md",
        "sdk/README.md",
        "ui/README.md",
        "mcp/README.md",
        "docs/README.md",
    ]

    missing = [path for path in required if not (ROOT / path).is_file()]
    assert not missing


def test_taskfile_exposes_required_tasks():
    taskfile = read("Taskfile.yml")
    for task in ["up", "down", "clean", "ps", "logs", "bootstrap", "roundtrip", "test"]:
        assert re.search(rf"(?m)^  {re.escape(task)}:\s*$", taskfile), task

    assert "scripts/bootstrap.sh" in taskfile
    assert "scripts/up.sh" in taskfile
    assert "scripts/roundtrip/spark_write.py" in taskfile
    assert "scripts/roundtrip/trino_read.py" in taskfile


def test_compose_services_are_pinned_and_health_checked():
    compose = read("docker/docker-compose.yml")
    for service in ["postgres", "polaris", "minio", "spark", "trino", "keycloak"]:
        assert re.search(rf"(?m)^  {service}:\s*$", compose), service

    assert ":latest" not in compose
    for image in [
        "apache/polaris:1.5.0",
        "apache/polaris-admin-tool:1.5.0",
        "postgres:16",
        "minio/minio:",
        "trinodb/trino:481",
        "quay.io/keycloak/keycloak:",
    ]:
        assert image in compose, image

    assert compose.count("healthcheck:") >= 5
    for port in ["8181", "9000", "9001", "4040", "8080", "8082"]:
        assert port in compose


def test_engine_configs_wire_polaris_and_minio():
    spark = read("docker/spark/spark-defaults.conf")
    trino = read("docker/trino/etc/catalog/iceberg.properties")

    for needle in [
        "spark.sql.catalog.quicksense",
        "org.apache.iceberg.rest.RESTCatalog",
        "http://polaris:8181/api/catalog",
        "PRINCIPAL_ROLE:ALL",
        "org.apache.iceberg.aws.s3.S3FileIO",
        "s3.access-key-id",
    ]:
        assert needle in spark

    for needle in [
        "connector.name=iceberg",
        "iceberg.catalog.type=rest",
        "http://polaris:8181/api/catalog",
        "iceberg.rest-catalog.security=OAUTH2",
        "iceberg.rest-catalog.vended-credentials-enabled=false",
        "fs.s3.enabled=true",
        "s3.endpoint=http://minio:9000",
        "s3.path-style-access=true",
    ]:
        assert needle in trino


def test_bootstrap_and_roundtrip_contract_markers():
    bootstrap = read("scripts/bootstrap.sh")
    lib = read("scripts/lib/bootstrap-common.sh")
    spark_write = read("scripts/roundtrip/spark_write.py")
    trino_read = read("scripts/roundtrip/trino_read.py")
    realm = read("docker/keycloak/realm-quicksense.json")

    # Markers that moved to the shared lib
    for needle in ["warehouse", "quicksense", "KEYCLOAK OK", "stsUnavailable", "CATALOG_MANAGE_CONTENT"]:
        assert needle in lib, needle

    # bootstrap.sh must still carry its own markers and source the lib
    assert "BOOTSTRAP OK" in bootstrap
    assert "scripts/lib/bootstrap-common.sh" in bootstrap

    for needle in ["CREATE NAMESPACE IF NOT EXISTS quicksense.demo", "CREATE TABLE IF NOT EXISTS quicksense.demo.events", "INSERT INTO quicksense.demo.events"]:
        assert needle in spark_write

    assert "SELECT id, name, ts FROM iceberg.demo.events ORDER BY id" in trino_read
    assert "ROUNDTRIP OK" in trino_read

    for needle in ["quicksense", "quicksense-api", "service-account-quicksense-api", "qsuser", "polaris_admin"]:
        assert needle in realm


def test_readme_documents_quickstart_ports_credentials_and_oidc_note():
    readme = read("README.md")
    for needle in [
        "task up",
        "task bootstrap",
        "task roundtrip",
        "task clean",
        "localhost:8181",
        "localhost:9000",
        "localhost:9001",
        "localhost:4040",
        "localhost:8080",
        "localhost:8082",
        "root",
        "s3cr3t",
        "Keycloak is wired but not enforced",
    ]:
        assert needle in readme


def test_kind_cluster_config():
    cfg = yaml.safe_load(read("deploy/k8s/kind-cluster.yaml"))
    assert cfg["kind"] == "Cluster" and cfg["apiVersion"].startswith("kind.x-k8s.io/")
    nodes = cfg["nodes"]
    assert sum(1 for n in nodes if n["role"] == "control-plane") == 1
    mapped = {m["hostPort"] for n in nodes for m in n.get("extraPortMappings", [])}
    for port in [8181, 9000, 9001, 4040, 8080, 8082]:
        assert port in mapped, port


def test_k8s_required_files_exist():
    required = [
        "deploy/k8s/kind-cluster.yaml",
        "deploy/k8s/base/postgres.yaml",
        "deploy/k8s/base/minio.yaml",
        "deploy/k8s/base/polaris.yaml",
        "deploy/k8s/base/trino.yaml",
        "deploy/k8s/base/keycloak.yaml",
        "deploy/k8s/base/spark.yaml",
        "deploy/k8s/base/trino-read-job.yaml",
        "deploy/k8s/README.md",
        "deploy/k8s/config/README.md",
        "scripts/k8s/kind-up.sh",
        "scripts/k8s/kind-bootstrap.sh",
        "scripts/k8s/kind-roundtrip.sh",
        "scripts/lib/bootstrap-common.sh",
    ]
    assert not [p for p in required if not (ROOT / p).is_file()]


def test_kind_bootstrap_script_contract():
    s = read("scripts/k8s/kind-bootstrap.sh")
    lib = read("scripts/lib/bootstrap-common.sh")
    assert "scripts/lib/bootstrap-common.sh" in s
    assert "kubectl port-forward" in s
    assert "minio/mc:RELEASE.2025-08-13T08-35-41Z" in s
    assert "BOOTSTRAP OK" in s
    for n in ["/api/catalog/v1/oauth/tokens", "Polaris-Realm", "PRINCIPAL_ROLE:ALL",
              "stsUnavailable", "CATALOG_MANAGE_CONTENT", "KEYCLOAK OK"]:
        assert n in lib, n


def test_taskfile_exposes_kind_tasks():
    tf = read("Taskfile.yml")
    for t in ["kind-up", "kind-bootstrap", "kind-roundtrip", "kind-down"]:
        assert re.search(rf"(?m)^  {re.escape(t)}:\s*$", tf), t
    for n in ["scripts/k8s/kind-up.sh", "scripts/k8s/kind-bootstrap.sh", "scripts/k8s/kind-roundtrip.sh"]:
        assert n in tf


# ---------------------------------------------------------------------------
# Tasks A3–A7: base K8s service manifests
# ---------------------------------------------------------------------------


def k8s_docs(path):
    return [d for d in yaml.safe_load_all(read(path)) if d]


def test_postgres_manifest():
    docs = k8s_docs("deploy/k8s/base/postgres.yaml")
    assert {"Deployment", "Service", "PersistentVolumeClaim"} <= {d["kind"] for d in docs}
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "postgres"
    c = next(d for d in docs if d["kind"] == "Deployment")["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "postgres:16"
    assert {list(f)[0] for f in c["envFrom"]} >= {"configMapRef", "secretRef"}
    assert ":latest" not in read("deploy/k8s/base/postgres.yaml")


def test_minio_manifest():
    docs = k8s_docs("deploy/k8s/base/minio.yaml")
    assert {"Deployment", "Service", "PersistentVolumeClaim"} <= {d["kind"] for d in docs}
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "minio"
    c = next(d for d in docs if d["kind"] == "Deployment")["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "minio/minio:RELEASE.2025-09-07T16-13-09Z"
    assert {list(f)[0] for f in c["envFrom"]} >= {"configMapRef", "secretRef"}
    assert ":latest" not in read("deploy/k8s/base/minio.yaml")
    # NodePort assertions
    ports = {p["port"]: p.get("nodePort") for p in svc["spec"]["ports"]}
    assert ports.get(9000) == 30900
    assert ports.get(9001) == 30901


def test_polaris_manifest():
    docs = k8s_docs("deploy/k8s/base/polaris.yaml")
    kinds = {d["kind"] for d in docs}
    assert {"Job", "Deployment", "Service"} <= kinds
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "polaris"
    # Bootstrap Job image
    job = next(d for d in docs if d["kind"] == "Job")
    job_container = job["spec"]["template"]["spec"]["containers"][0]
    assert job_container["image"] == "apache/polaris-admin-tool:1.5.0"
    # Deployment image
    c = next(d for d in docs if d["kind"] == "Deployment")["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "apache/polaris:1.5.0"
    assert {list(f)[0] for f in c["envFrom"]} >= {"configMapRef", "secretRef"}
    # Dotted feature-flag env keys present
    env_names = {e["name"] for e in c["env"]}
    assert 'polaris.features."ALLOW_INSECURE_STORAGE_TYPES"' in env_names
    assert 'polaris.features."ALLOW_SETTING_S3_ENDPOINTS"' in env_names
    assert 'polaris.features."SUPPORTED_CATALOG_STORAGE_TYPES"' in env_names
    # JDBC URL
    jdbc = next(e["value"] for e in c["env"] if e["name"] == "QUARKUS_DATASOURCE_JDBC_URL")
    assert "jdbc:postgresql://postgres:5432/" in jdbc
    assert ":latest" not in read("deploy/k8s/base/polaris.yaml")


def test_trino_manifest():
    docs = k8s_docs("deploy/k8s/base/trino.yaml")
    assert {"Deployment", "Service"} <= {d["kind"] for d in docs}
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "trino"
    c = next(d for d in docs if d["kind"] == "Deployment")["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "trinodb/trino:481"
    assert {list(f)[0] for f in c["envFrom"]} >= {"configMapRef", "secretRef"}
    # Two ConfigMap volume mounts
    mount_paths = {vm["mountPath"] for vm in c["volumeMounts"]}
    assert "/etc/trino" in mount_paths
    assert "/etc/trino/catalog" in mount_paths
    assert ":latest" not in read("deploy/k8s/base/trino.yaml")


def test_keycloak_manifest():
    docs = k8s_docs("deploy/k8s/base/keycloak.yaml")
    assert {"Deployment", "Service"} <= {d["kind"] for d in docs}
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "keycloak"
    deploy = next(d for d in docs if d["kind"] == "Deployment")
    c = deploy["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "quay.io/keycloak/keycloak:26.3.3"
    assert {list(f)[0] for f in c["envFrom"]} >= {"configMapRef", "secretRef"}
    # Import-realm args
    assert "start-dev" in c["args"]
    assert "--import-realm" in c["args"]
    # Realm volume mount
    mount_paths = {vm["mountPath"] for vm in c["volumeMounts"]}
    assert "/opt/keycloak/data/import" in mount_paths
    assert ":latest" not in read("deploy/k8s/base/keycloak.yaml")


def test_kind_up_script_contract():
    s = read("scripts/k8s/kind-up.sh")
    for n in ["kind create cluster", "--name quicksense", "deploy/k8s/kind-cluster.yaml",
        "kind load docker-image quicksense-spark:latest", "--from-env-file",
        "kubectl create secret generic qs-secrets", "--from-file=config.properties=docker/trino/etc/config.properties",
        "docker/keycloak/realm-quicksense.json", "scripts/roundtrip/spark_write.py",
        "kubectl rollout status", "--for=condition=complete"]:
        assert n in s, n


def test_spark_manifest_and_roundtrip():
    docs = k8s_docs("deploy/k8s/base/spark.yaml")
    c = next(d for d in docs if d["kind"] == "Deployment")["spec"]["template"]["spec"]["containers"][0]
    assert c["image"] == "quicksense-spark:latest" and c["imagePullPolicy"] in ("Never", "IfNotPresent")
    svc = next(d for d in docs if d["kind"] == "Service")
    assert svc["metadata"]["name"] == "spark"
    assert {15002, 4040} <= {p["port"] for p in svc["spec"]["ports"]}
    rt = read("scripts/k8s/kind-roundtrip.sh")
    assert "kubectl exec" in rt and "spark-submit /workspace/scripts/roundtrip/spark_write.py" in rt
    assert "trino_read.py" in rt and "quicksense-trino-client:latest" in rt and "ROUNDTRIP OK" in rt


def test_k8s_readme_documents_kind_path():
    d = read("deploy/k8s/README.md")
    for n in ["kind", "task kind-up", "task kind-bootstrap", "task kind-roundtrip", "task kind-down",
              "kind load docker-image", "Spark Connect"]:
        assert n in d, n


def test_root_readme_documents_two_tiers():
    r = read("README.md")
    for n in ["task kind-up", "task kind-bootstrap", "task kind-roundtrip", "task kind-down",
              "dev mode", "Kubernetes"]:
        assert n in r, n
