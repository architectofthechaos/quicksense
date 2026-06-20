// SPDX-License-Identifier: Apache-2.0

package config_test

import (
	"testing"

	"github.com/deepiq/quicksense/api/internal/config"
)

// fakeEnv returns a getenv func backed by the provided map.
func fakeEnv(m map[string]string) func(string) string {
	return func(key string) string {
		return m[key]
	}
}

// fullEnv is a complete, valid env map derived from .env.example values.
var fullEnv = map[string]string{
	"POSTGRES_USER":        "postgres",
	"POSTGRES_PASSWORD":    "postgres",
	"POSTGRES_PORT":        "5432",
	"POLARIS_PORT":         "8181",
	"POLARIS_REALM":        "POLARIS",
	"POLARIS_CLIENT_ID":    "root",
	"POLARIS_CLIENT_SECRET": "s3cr3t",
	"POLARIS_CATALOG":      "quicksense",
	"KEYCLOAK_PORT":        "8082",
	"KEYCLOAK_REALM":       "quicksense",
	"KEYCLOAK_CLIENT_ID":   "quicksense-api",
	"KEYCLOAK_CLIENT_SECRET": "qs-api-secret",
}

func TestLoadFrom_AllFields(t *testing.T) {
	cfg, err := config.LoadFrom(fakeEnv(fullEnv))
	if err != nil {
		t.Fatalf("LoadFrom returned error: %v", err)
	}

	// Postgres fields
	if cfg.PostgresUser != "postgres" {
		t.Errorf("PostgresUser = %q; want %q", cfg.PostgresUser, "postgres")
	}
	if cfg.PostgresPassword != "postgres" {
		t.Errorf("PostgresPassword = %q; want %q", cfg.PostgresPassword, "postgres")
	}
	if cfg.PostgresPort != "5432" {
		t.Errorf("PostgresPort = %q; want %q", cfg.PostgresPort, "5432")
	}

	// Derived DSN for the QUICKSENSE database
	wantDSN := "postgres://postgres:postgres@postgres:5432/QUICKSENSE?sslmode=disable"
	if cfg.DSN != wantDSN {
		t.Errorf("DSN = %q; want %q", cfg.DSN, wantDSN)
	}

	// Admin DSN (points to 'postgres' maintenance DB)
	wantAdminDSN := "postgres://postgres:postgres@postgres:5432/postgres?sslmode=disable"
	if cfg.AdminDSN != wantAdminDSN {
		t.Errorf("AdminDSN = %q; want %q", cfg.AdminDSN, wantAdminDSN)
	}

	// Polaris fields
	if cfg.PolarisPort != "8181" {
		t.Errorf("PolarisPort = %q; want %q", cfg.PolarisPort, "8181")
	}
	if cfg.PolarisRealm != "POLARIS" {
		t.Errorf("PolarisRealm = %q; want %q", cfg.PolarisRealm, "POLARIS")
	}
	if cfg.PolarisClientID != "root" {
		t.Errorf("PolarisClientID = %q; want %q", cfg.PolarisClientID, "root")
	}
	if cfg.PolarisClientSecret != "s3cr3t" {
		t.Errorf("PolarisClientSecret = %q; want %q", cfg.PolarisClientSecret, "s3cr3t")
	}
	if cfg.PolarisCatalog != "quicksense" {
		t.Errorf("PolarisCatalog = %q; want %q", cfg.PolarisCatalog, "quicksense")
	}

	// Keycloak fields
	if cfg.KeycloakPort != "8082" {
		t.Errorf("KeycloakPort = %q; want %q", cfg.KeycloakPort, "8082")
	}
	if cfg.KeycloakRealm != "quicksense" {
		t.Errorf("KeycloakRealm = %q; want %q", cfg.KeycloakRealm, "quicksense")
	}
	if cfg.KeycloakClientID != "quicksense-api" {
		t.Errorf("KeycloakClientID = %q; want %q", cfg.KeycloakClientID, "quicksense-api")
	}
	if cfg.KeycloakClientSecret != "qs-api-secret" {
		t.Errorf("KeycloakClientSecret = %q; want %q", cfg.KeycloakClientSecret, "qs-api-secret")
	}

	// Derived JWKS URL
	wantJWKS := "http://keycloak:8082/realms/quicksense/protocol/openid-connect/certs"
	if cfg.KeycloakJWKSURL != wantJWKS {
		t.Errorf("KeycloakJWKSURL = %q; want %q", cfg.KeycloakJWKSURL, wantJWKS)
	}

	// Default required role
	if cfg.RequiredRole != "polaris_admin" {
		t.Errorf("RequiredRole = %q; want %q", cfg.RequiredRole, "polaris_admin")
	}
}

func TestLoadFrom_CustomHosts(t *testing.T) {
	env := make(map[string]string)
	for k, v := range fullEnv {
		env[k] = v
	}
	env["POSTGRES_HOST"] = "mydb.internal"
	env["POLARIS_HOST"] = "polaris.internal"
	env["KEYCLOAK_HOST"] = "kc.internal"

	cfg, err := config.LoadFrom(fakeEnv(env))
	if err != nil {
		t.Fatalf("LoadFrom error: %v", err)
	}

	wantDSN := "postgres://postgres:postgres@mydb.internal:5432/QUICKSENSE?sslmode=disable"
	if cfg.DSN != wantDSN {
		t.Errorf("DSN = %q; want %q", cfg.DSN, wantDSN)
	}

	wantJWKS := "http://kc.internal:8082/realms/quicksense/protocol/openid-connect/certs"
	if cfg.KeycloakJWKSURL != wantJWKS {
		t.Errorf("KeycloakJWKSURL = %q; want %q", cfg.KeycloakJWKSURL, wantJWKS)
	}
}

func TestLoadFrom_MissingRequired(t *testing.T) {
	// Empty env — all required vars missing; should return a non-nil error.
	_, err := config.LoadFrom(fakeEnv(map[string]string{}))
	if err == nil {
		t.Fatal("expected error for missing required vars, got nil")
	}
}

func TestCatalogSparkConf(t *testing.T) {
	cfg, err := config.LoadFrom(fakeEnv(fullEnv))
	if err != nil {
		t.Fatalf("LoadFrom error: %v", err)
	}
	sc := cfg.CatalogSparkConf()

	// defaultCatalog must equal PolarisCatalog (quicksense).
	if got := sc["spark.sql.defaultCatalog"]; got != "quicksense" {
		t.Errorf("spark.sql.defaultCatalog = %q; want quicksense", got)
	}
	// Catalog URI must encode PolarisHost:PolarisPort.
	wantURI := "http://polaris:8181/api/catalog"
	if got := sc["spark.sql.catalog.quicksense.uri"]; got != wantURI {
		t.Errorf("catalog uri = %q; want %q", got, wantURI)
	}
	// Credential must encode ClientID:ClientSecret.
	wantCred := "root:s3cr3t"
	if got := sc["spark.sql.catalog.quicksense.credential"]; got != wantCred {
		t.Errorf("credential = %q; want %q", got, wantCred)
	}
	// Polaris-Realm header must equal PolarisRealm.
	if got := sc["spark.sql.catalog.quicksense.header.Polaris-Realm"]; got != "POLARIS" {
		t.Errorf("Polaris-Realm header = %q; want POLARIS", got)
	}
	// MinIO S3 endpoint must use the default.
	if got := sc["spark.sql.catalog.quicksense.s3.endpoint"]; got != "http://minio:9000" {
		t.Errorf("s3.endpoint = %q; want http://minio:9000", got)
	}
	// oauth2-server-uri must append /v1/oauth/tokens.
	wantOAuth := "http://polaris:8181/api/catalog/v1/oauth/tokens"
	if got := sc["spark.sql.catalog.quicksense.oauth2-server-uri"]; got != wantOAuth {
		t.Errorf("oauth2-server-uri = %q; want %q", got, wantOAuth)
	}
}

func TestCatalogSparkConf_MinioOverride(t *testing.T) {
	env := make(map[string]string)
	for k, v := range fullEnv {
		env[k] = v
	}
	env["MINIO_ENDPOINT"] = "http://minio.internal:9000"
	env["MINIO_ROOT_USER"] = "myaccess"
	env["MINIO_ROOT_PASSWORD"] = "mysecret"
	env["MINIO_REGION"] = "eu-west-1"

	cfg, err := config.LoadFrom(fakeEnv(env))
	if err != nil {
		t.Fatalf("LoadFrom error: %v", err)
	}
	sc := cfg.CatalogSparkConf()

	if got := sc["spark.sql.catalog.quicksense.s3.endpoint"]; got != "http://minio.internal:9000" {
		t.Errorf("s3.endpoint = %q; want http://minio.internal:9000", got)
	}
	if got := sc["spark.sql.catalog.quicksense.s3.access-key-id"]; got != "myaccess" {
		t.Errorf("access-key-id = %q; want myaccess", got)
	}
	if got := sc["spark.sql.catalog.quicksense.client.region"]; got != "eu-west-1" {
		t.Errorf("client.region = %q; want eu-west-1", got)
	}
}

func TestConfigParsesSparkFields(t *testing.T) {
	t.Run("explicit values", func(t *testing.T) {
		env := make(map[string]string)
		for k, v := range fullEnv {
			env[k] = v
		}
		env["QS_SPARK_IMAGE"] = "quicksense-spark:dev"
		env["QS_SPARK_NAMESPACE"] = "quicksense"
		env["QS_CLUSTER_EXECUTORS"] = "3"

		cfg, err := config.LoadFrom(fakeEnv(env))
		if err != nil {
			t.Fatalf("LoadFrom error: %v", err)
		}

		if cfg.SparkImage != "quicksense-spark:dev" {
			t.Errorf("SparkImage = %q; want %q", cfg.SparkImage, "quicksense-spark:dev")
		}
		if cfg.SparkConnectNamespace != "quicksense" {
			t.Errorf("SparkConnectNamespace = %q; want %q", cfg.SparkConnectNamespace, "quicksense")
		}
		if cfg.ClusterDefaultExecutors != 3 {
			t.Errorf("ClusterDefaultExecutors = %d; want %d", cfg.ClusterDefaultExecutors, 3)
		}
	})

	t.Run("defaults when unset", func(t *testing.T) {
		cfg, err := config.LoadFrom(fakeEnv(fullEnv))
		if err != nil {
			t.Fatalf("LoadFrom error: %v", err)
		}

		if cfg.SparkImage != "quicksense-spark:latest" {
			t.Errorf("SparkImage default = %q; want %q", cfg.SparkImage, "quicksense-spark:latest")
		}
		// Default is "default" (co-located with the base stack so short-name DNS resolves).
		if cfg.SparkConnectNamespace != "default" {
			t.Errorf("SparkConnectNamespace default = %q; want %q", cfg.SparkConnectNamespace, "default")
		}
		if cfg.ClusterDefaultExecutors != 1 {
			t.Errorf("ClusterDefaultExecutors default = %d; want %d", cfg.ClusterDefaultExecutors, 1)
		}
		if cfg.KubeconfigPath != "" {
			t.Errorf("KubeconfigPath default = %q; want %q", cfg.KubeconfigPath, "")
		}
	})
}
