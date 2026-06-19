# SPDX-License-Identifier: Apache-2.0
"""Static contract tests for SPEC-001 infrastructure deliverables."""

from pathlib import Path
import re
import pytest


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
    spark_write = read("scripts/roundtrip/spark_write.py")
    trino_read = read("scripts/roundtrip/trino_read.py")
    realm = read("docker/keycloak/realm-quicksense.json")

    for needle in ["warehouse", "quicksense", "KEYCLOAK OK", "stsUnavailable", "CATALOG_MANAGE_CONTENT"]:
        assert needle in bootstrap

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


@pytest.mark.xfail(reason="Phase A WIP — files land across A2-A11", strict=False)
def test_k8s_required_files_exist():
    required = [
        "deploy/k8s/kind-cluster.yaml",
        "deploy/k8s/base/postgres.yaml",
        "deploy/k8s/base/minio.yaml",
        "deploy/k8s/base/polaris.yaml",
        "deploy/k8s/base/trino.yaml",
        "deploy/k8s/base/keycloak.yaml",
        "deploy/k8s/base/spark.yaml",
        "deploy/k8s/README.md",
        "scripts/k8s/kind-up.sh",
        "scripts/k8s/kind-bootstrap.sh",
        "scripts/k8s/kind-roundtrip.sh",
    ]
    assert not [p for p in required if not (ROOT / p).is_file()]


def test_taskfile_exposes_kind_tasks():
    tf = read("Taskfile.yml")
    for t in ["kind-up", "kind-bootstrap", "kind-roundtrip", "kind-down"]:
        assert re.search(rf"(?m)^  {re.escape(t)}:\s*$", tf), t
    for n in ["scripts/k8s/kind-up.sh", "scripts/k8s/kind-bootstrap.sh", "scripts/k8s/kind-roundtrip.sh"]:
        assert n in tf
