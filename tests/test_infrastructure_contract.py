# SPDX-License-Identifier: Apache-2.0
"""Static contract tests for SPEC-001 infrastructure deliverables."""

from pathlib import Path
import re
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
        "Keycloak is enforced",
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


# ---------------------------------------------------------------------------
# Task B9: main wiring + Dockerfile + api/README
# ---------------------------------------------------------------------------


def test_api_b9_required_files_exist():
    """api/go.mod, main.go, Dockerfile, and api/README.md must all exist."""
    required = [
        "api/go.mod",
        "api/cmd/quicksense-api/main.go",
        "api/Dockerfile",
        "api/README.md",
    ]
    missing = [p for p in required if not (ROOT / p).is_file()]
    assert not missing, missing


def test_api_go_mod_module_and_deps():
    """go.mod must declare the right module path and key dependencies."""
    gomod = read("api/go.mod")
    assert "module github.com/deepiq/quicksense/api" in gomod
    for dep in ["go-chi/chi", "pgx", "golang-migrate", "golang-jwt", "keyfunc"]:
        assert dep in gomod, dep


def test_api_main_wires_full_dependency_chain():
    """main.go must reference config, store, polaris, auth and http packages."""
    main = read("api/cmd/quicksense-api/main.go")
    for needle in [
        "config.Load",
        "store.EnsureDatabase",
        "store.Migrate",
        "store.New",
        "polaris.NewHTTPClient",
        "auth.NewKeycloakVerifier",
        "httpapi.NewRouter",
        "httpapi.RouterDeps",
        ":8080",
    ]:
        assert needle in main, needle


def test_api_dockerfile_is_multistage():
    """Dockerfile must be multi-stage (builder + runtime) with pinned images."""
    df = read("api/Dockerfile")
    # Two FROM lines = multi-stage
    assert df.count("FROM ") >= 2
    # No :latest
    assert ":latest" not in df
    # Builder uses a golang image
    assert "golang:" in df
    # Runtime is distroless or alpine
    assert ("distroless" in df or "alpine:" in df)
    # Build the binary
    assert "go build" in df
    assert "quicksense-api" in df
    # Expose port
    assert "EXPOSE 8080" in df
    assert "ENTRYPOINT" in df


def test_api_readme_documents_env_routes_and_run():
    """api/README.md must cover env vars, routes, and how to run."""
    readme = read("api/README.md")
    for needle in [
        "POSTGRES_",
        "POLARIS_",
        "KEYCLOAK_",
        "/healthz",
        "/v1/catalogs",
        "go run",
        "cmd/quicksense-api",
    ]:
        assert needle in readme, needle


def test_keycloak_realm_sslrequired_none():
    """Dev realm sets sslRequired=NONE (spec §4.3) to avoid the HTTPS-required nag."""
    realm = yaml.safe_load(read("docker/keycloak/realm-quicksense.json"))
    assert realm["sslRequired"] == "NONE"


# ---------------------------------------------------------------------------
# Task B16: Spark Operator Helm install assets
# ---------------------------------------------------------------------------


def test_spark_operator_assets_present_and_pinned():
    """Spark Operator Helm assets exist and contain required pinned values."""
    # 1. All three files must exist
    for path in [
        "deploy/k8s/spark-operator/values.yaml",
        "deploy/k8s/spark-operator/NOTES.md",
        "scripts/k8s/operator-install.sh",
    ]:
        assert (ROOT / path).is_file(), f"Missing: {path}"

    # 2. NOTES.md must reference the pinned chart version and repo URL
    notes = read("deploy/k8s/spark-operator/NOTES.md")
    assert "2.5.1" in notes
    assert "kubeflow.github.io/spark-operator" in notes

    # 3. Taskfile must expose an operator-install target referencing the script
    tf = read("Taskfile.yml")
    assert re.search(r"(?m)^  operator-install:\s*$", tf), "operator-install target missing"
    assert "scripts/k8s/operator-install.sh" in tf

    # 4. Install script must contain helm, --version, 2.5.1, and success marker
    script = read("scripts/k8s/operator-install.sh")
    for needle in ["helm", "--version", "2.5.1", "OPERATOR INSTALL OK"]:
        assert needle in script, f"Missing '{needle}' in operator-install.sh"

    # 5. values.yaml must name the watched namespace
    values = read("deploy/k8s/spark-operator/values.yaml")
    assert "quicksense" in values


# ---------------------------------------------------------------------------
# Task B18: Polaris external OIDC (mixed realm)
# ---------------------------------------------------------------------------


def test_polaris_manifest_has_external_oidc_config():
    """Polaris Deployment env must contain external OIDC (Keycloak) tenant keys,
    polaris.authentication.type=mixed (live-verified: Polaris 1.5 supports MIXED —
    both internal root:s3cr3t and Keycloak JWTs accepted simultaneously), and
    polaris.oidc.principal-mapper.name-claim-path=preferred_username (required for
    Polaris to resolve the JWT principal by name; id-claim-path=sub must NOT be used
    as Polaris parses the id as numeric and UUID sub throws NumberFormatException)."""
    raw = read("deploy/k8s/base/polaris.yaml")
    # OIDC tenant enabled
    assert "quarkus.oidc.tenant-enabled" in raw
    # Keycloak issuer URL
    assert "http://keycloak:8082/realms/quicksense" in raw
    # Client-id key and value
    assert "quarkus.oidc.client-id" in raw
    assert "quicksense-api" in raw
    # Role claim path key and value
    assert "quarkus.oidc.roles.role-claim-path" in raw
    assert "realm_access/roles" in raw
    # Principal-roles mapper type
    assert "polaris.oidc.principal-roles-mapper.type" in raw
    # Mapper regex: ^polaris_(.*)
    assert "^polaris_(.*)" in raw
    # Mapper replacement: PRINCIPAL_ROLE:$1
    assert "PRINCIPAL_ROLE:$1" in raw
    # Internal realm name must still be present
    assert "POLARIS" in raw
    # name-claim-path must be set to preferred_username (the missing piece for principal resolution)
    assert "polaris.oidc.principal-mapper.name-claim-path" in raw
    assert "preferred_username" in raw
    # authentication.type must be present and set to "mixed" (live-verified Polaris 1.5).
    # Use YAML parse to check the env value directly (comments may also contain words).
    assert 'polaris.authentication.type' in raw
    docs = k8s_docs("deploy/k8s/base/polaris.yaml")
    deploy = next(d for d in docs if d["kind"] == "Deployment")
    c = deploy["spec"]["template"]["spec"]["containers"][0]
    auth_env = next(
        (e for e in c["env"] if e.get("name") == "polaris.authentication.type"), None
    )
    assert auth_env is not None, "polaris.authentication.type env var missing"
    assert auth_env["value"] == "mixed", (
        f"polaris.authentication.type must be 'mixed', got {auth_env['value']!r}"
    )
    # name-claim-path env var must also be set to preferred_username
    name_claim_env = next(
        (e for e in c["env"] if e.get("name") == "polaris.oidc.principal-mapper.name-claim-path"), None
    )
    assert name_claim_env is not None, "polaris.oidc.principal-mapper.name-claim-path env var missing"
    assert name_claim_env["value"] == "preferred_username", (
        f"name-claim-path must be 'preferred_username', got {name_claim_env['value']!r}"
    )


# ---------------------------------------------------------------------------
# Task B19: Bootstrap — Polaris admin principal-role
# ---------------------------------------------------------------------------


def test_bootstrap_creates_polaris_admin_principal_role():
    """bootstrap-common.sh must contain ensure_polaris_admin_principal_role and both
    bootstrap scripts must call it."""
    lib = read("scripts/lib/bootstrap-common.sh")
    # Function must exist with principal-role API paths
    assert "principal-roles" in lib
    assert '"admin"' in lib or 'name":"admin' in lib or "name\": \"admin" in lib
    assert "catalog-roles" in lib
    assert "ensure_polaris_admin_principal_role" in lib

    # Both call-sites must invoke the function
    bootstrap = read("scripts/bootstrap.sh")
    assert "ensure_polaris_admin_principal_role" in bootstrap

    kind_bootstrap = read("scripts/k8s/kind-bootstrap.sh")
    assert "ensure_polaris_admin_principal_role" in kind_bootstrap


def test_bootstrap_creates_polaris_external_principal():
    """bootstrap-common.sh must contain ensure_polaris_external_principal that creates
    the service-account-quicksense-api Polaris principal (the Keycloak service-account
    token's preferred_username), and both bootstrap scripts must call it."""
    lib = read("scripts/lib/bootstrap-common.sh")
    assert "ensure_polaris_external_principal" in lib
    assert "service-account-quicksense-api" in lib

    bootstrap = read("scripts/bootstrap.sh")
    assert "ensure_polaris_external_principal" in bootstrap

    kind_bootstrap = read("scripts/k8s/kind-bootstrap.sh")
    assert "ensure_polaris_external_principal" in kind_bootstrap


# ---------------------------------------------------------------------------
# Task B21: SC_REMOTE round-trip mode + api.yaml Deployment/RBAC + build targets
# ---------------------------------------------------------------------------


def test_spark_write_sc_remote_mode():
    """spark_write.py must support opt-in SC_REMOTE remote mode while keeping
    Phase A / Compose byte-compatibility (getOrCreate path unchanged)."""
    sw = read("scripts/roundtrip/spark_write.py")
    assert ".remote(" in sw, "SC_REMOTE remote() call missing"
    # Phase A needles must still be present
    for needle in [
        "CREATE NAMESPACE IF NOT EXISTS quicksense.demo",
        "CREATE TABLE IF NOT EXISTS quicksense.demo.events",
        "INSERT INTO quicksense.demo.events",
    ]:
        assert needle in sw, needle


def test_api_yaml_deployment_rbac_and_service():
    """deploy/k8s/api.yaml must contain a Deployment, Service, ServiceAccount,
    Role/RoleBinding for sparkconnects, and the serviceAccountName field."""
    docs = k8s_docs("deploy/k8s/api.yaml")
    kinds = {d["kind"] for d in docs}
    assert "Deployment" in kinds, "Deployment missing from api.yaml"
    assert "Service" in kinds, "Service missing from api.yaml"
    assert "ServiceAccount" in kinds, "ServiceAccount missing from api.yaml"

    raw = read("deploy/k8s/api.yaml")
    assert "sparkconnects" in raw, "sparkconnects RBAC missing from api.yaml"
    assert "serviceAccountName" in raw, "serviceAccountName missing from api.yaml"

    # Deployment must reference the locally-built image
    deploy = next(d for d in docs if d["kind"] == "Deployment")
    c = deploy["spec"]["template"]["spec"]["containers"][0]
    assert "quicksense-api" in c["image"]

    # Service must expose port 8090
    svc = next(d for d in docs if d["kind"] == "Service")
    ports = [p["port"] for p in svc["spec"]["ports"]]
    assert 8090 in ports, f"Port 8090 not found in Service ports: {ports}"


def test_taskfile_exposes_api_build_and_run():
    """Taskfile.yml must expose api-build and api-run targets."""
    tf = read("Taskfile.yml")
    assert re.search(r"(?m)^  api-build:\s*$", tf), "api-build target missing"
    assert re.search(r"(?m)^  api-run:\s*$", tf), "api-run target missing"
    assert "api-build" in tf
    assert "api-run" in tf


# ---------------------------------------------------------------------------
# Task B22: api-e2e end-to-end script + Taskfile target
# ---------------------------------------------------------------------------


def test_api_e2e_and_assets():
    """Taskfile must expose api-e2e; scripts/k8s/api-e2e.sh must contain the
    full e2e flow markers."""
    tf = read("Taskfile.yml")
    assert re.search(r"(?m)^  api-e2e:\s*$", tf), "api-e2e target missing"
    assert "scripts/k8s/api-e2e.sh" in tf

    e2e = read("scripts/k8s/api-e2e.sh")
    for needle in [
        "API E2E OK",
        "/v1/clusters",
        "/v1/catalogs",
        "openid-connect/token",
    ]:
        assert needle in e2e, f"Missing '{needle}' in api-e2e.sh"


def test_readme_documents_phase_b():
    """Root README must document Phase B: API routes, operator, OIDC, and task commands."""
    readme = read("README.md")
    for needle in [
        "task api-e2e",
        "task operator-install",
        "spark-operator",
        "2.5.1",
        "SparkConnect",
        "sc://",
        "OIDC",
        "/v1/clusters",
    ]:
        assert needle in readme, f"Missing '{needle}' in README.md"
