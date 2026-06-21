// SPDX-License-Identifier: Apache-2.0

// Package config holds the runtime configuration for the QuickSense API.
// All values are sourced from environment variables; LoadFrom accepts an
// injectable getenv function for testability while Load wraps os.Getenv.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
)

// Config is the fully-resolved runtime configuration.
type Config struct {
	// Postgres connection info (same instance as Polaris; new QUICKSENSE DB).
	PostgresHost     string
	PostgresUser     string
	PostgresPassword string
	PostgresPort     string

	// DSN is the data-source name for the QUICKSENSE application database.
	// Pattern: postgres://user:pass@host:port/QUICKSENSE?sslmode=disable
	DSN string

	// AdminDSN connects to the 'postgres' maintenance DB; used for CREATE DATABASE.
	AdminDSN string

	// Polaris REST proxy settings.
	PolarisHost         string
	PolarisPort         string
	PolarisRealm        string
	PolarisClientID     string
	PolarisClientSecret string
	PolarisCatalog      string

	// Keycloak OIDC settings.
	KeycloakHost         string
	KeycloakPort         string
	KeycloakRealm        string
	KeycloakClientID     string
	KeycloakClientSecret string

	// KeycloakJWKSURL is derived from host/port/realm.
	// Pattern: http://<host>:<port>/realms/<realm>/protocol/openid-connect/certs
	KeycloakJWKSURL string

	// KeycloakIssuer is the expected `iss` claim on validated JWTs.
	// Default: derived from host/port/realm (same as JWKS). Override with
	// KEYCLOAK_ISSUER when browser-minted tokens carry a different issuer host
	// (e.g. localhost vs the in-cluster keycloak service). The JWKS fetch URL is
	// always KeycloakJWKSURL, so the two may differ.
	KeycloakIssuer string

	// RequiredRole is the Keycloak role checked on every authenticated request.
	// Default: "polaris_admin".
	RequiredRole string

	// Spark / cluster settings.
	SparkImage              string // QS_SPARK_IMAGE (default: quicksense-spark:latest)
	SparkConnectNamespace   string // QS_SPARK_NAMESPACE (default: default — co-located with base stack)
	ClusterDefaultExecutors int32  // QS_CLUSTER_EXECUTORS (default: 1)
	SparkServiceAccount     string // QS_SPARK_SA (default: spark-operator-spark)

	// MinIO / S3 settings for Iceberg catalog SparkConf.
	MinioEndpoint  string // MINIO_ENDPOINT (default: http://minio:9000)
	MinioAccessKey string // MINIO_ROOT_USER (default: minioadmin)
	MinioSecretKey string // MINIO_ROOT_PASSWORD (default: minioadmin)
	MinioRegion    string // MINIO_REGION (default: us-east-1)

	// Trino settings for catalog sample-data reads (4c).
	TrinoHost    string // TRINO_HOST (default: trino)
	TrinoPort    string // TRINO_PORT (default: 8080)
	TrinoUser    string // TRINO_USER (default: quicksense)
	TrinoCatalog string // TRINO_CATALOG (default: iceberg) — Trino catalog the Polaris catalog maps to

	// BrokerURL is the Spark Connect execution broker origin (4d-1).
	BrokerURL string // BROKER_URL (default: http://spark-broker:8099)

	// KubeconfigPath is the path to a kubeconfig file.
	// Empty string means in-cluster config.
	// Source: KUBECONFIG (default: "").
	KubeconfigPath string
}

// CatalogSparkConf returns the Iceberg/Polaris/MinIO catalog SparkConf map
// required by SparkConnect clusters to read and write the quicksense catalog.
// Keys and values mirror the validated live CR shape (Spark Operator 2.5.1).
func (c *Config) CatalogSparkConf() map[string]string {
	polarisURL := fmt.Sprintf("http://%s:%s/api/catalog", c.PolarisHost, c.PolarisPort)
	credential := fmt.Sprintf("%s:%s", c.PolarisClientID, c.PolarisClientSecret)
	cat := c.PolarisCatalog
	return map[string]string{
		"spark.sql.extensions":                                          "org.apache.iceberg.spark.extensions.IcebergSparkSessionExtensions",
		"spark.sql.catalog." + cat:                                      "org.apache.iceberg.spark.SparkCatalog",
		"spark.sql.catalog." + cat + ".catalog-impl":                   "org.apache.iceberg.rest.RESTCatalog",
		"spark.sql.catalog." + cat + ".uri":                            polarisURL,
		"spark.sql.catalog." + cat + ".warehouse":                      cat,
		"spark.sql.catalog." + cat + ".credential":                     credential,
		"spark.sql.catalog." + cat + ".scope":                          "PRINCIPAL_ROLE:ALL",
		"spark.sql.catalog." + cat + ".oauth2-server-uri":              polarisURL + "/v1/oauth/tokens",
		"spark.sql.catalog." + cat + ".header.Polaris-Realm":           c.PolarisRealm,
		"spark.sql.catalog." + cat + ".io-impl":                        "org.apache.iceberg.aws.s3.S3FileIO",
		"spark.sql.catalog." + cat + ".s3.endpoint":                    c.MinioEndpoint,
		"spark.sql.catalog." + cat + ".s3.path-style-access":           "true",
		"spark.sql.catalog." + cat + ".s3.access-key-id":               c.MinioAccessKey,
		"spark.sql.catalog." + cat + ".s3.secret-access-key":           c.MinioSecretKey,
		"spark.sql.catalog." + cat + ".client.region":                  c.MinioRegion,
		"spark.sql.defaultCatalog":                                      cat,
	}
}

// Load reads configuration from os.Getenv.
func Load() (*Config, error) {
	return LoadFrom(os.Getenv)
}

// LoadFrom reads configuration using the provided getenv function.
// Missing required variables are collected and returned as a single joined error.
func LoadFrom(getenv func(string) string) (*Config, error) {
	var errs []error

	required := func(key string) string {
		v := getenv(key)
		if v == "" {
			errs = append(errs, fmt.Errorf("required env var %s is not set", key))
		}
		return v
	}

	withDefault := func(key, def string) string {
		if v := getenv(key); v != "" {
			return v
		}
		return def
	}

	// Postgres
	pgHost := withDefault("POSTGRES_HOST", "postgres")
	pgUser := required("POSTGRES_USER")
	pgPass := required("POSTGRES_PASSWORD")
	pgPort := required("POSTGRES_PORT")

	// Polaris
	polarisHost := withDefault("POLARIS_HOST", "polaris")
	polarisPort := required("POLARIS_PORT")
	polarisRealm := required("POLARIS_REALM")
	polarisClientID := required("POLARIS_CLIENT_ID")
	polarisClientSecret := required("POLARIS_CLIENT_SECRET")
	polarisCatalog := required("POLARIS_CATALOG")

	// Keycloak
	kcHost := withDefault("KEYCLOAK_HOST", "keycloak")
	kcPort := required("KEYCLOAK_PORT")
	kcRealm := required("KEYCLOAK_REALM")
	kcClientID := required("KEYCLOAK_CLIENT_ID")
	kcClientSecret := required("KEYCLOAK_CLIENT_SECRET")

	if err := errors.Join(errs...); err != nil {
		return nil, err
	}

	dsn := fmt.Sprintf("postgres://%s:%s@%s:%s/QUICKSENSE?sslmode=disable",
		pgUser, pgPass, pgHost, pgPort)
	adminDSN := fmt.Sprintf("postgres://%s:%s@%s:%s/postgres?sslmode=disable",
		pgUser, pgPass, pgHost, pgPort)
	jwksURL := fmt.Sprintf("http://%s:%s/realms/%s/protocol/openid-connect/certs",
		kcHost, kcPort, kcRealm)
	derivedIssuer := fmt.Sprintf("http://%s:%s/realms/%s", kcHost, kcPort, kcRealm)
	keycloakIssuer := withDefault("KEYCLOAK_ISSUER", derivedIssuer)

	requiredRole := withDefault("REQUIRED_ROLE", "polaris_admin")

	// Spark / cluster settings (all optional with defaults).
	sparkImage := withDefault("QS_SPARK_IMAGE", "quicksense-spark:latest")
	// QS_SPARK_NAMESPACE defaults to "default" (co-located with polaris/minio base stack)
	// so SparkConnect driver/executor pods resolve short-name DNS (e.g. "polaris", "minio").
	sparkNamespace := withDefault("QS_SPARK_NAMESPACE", "default")
	sparkServiceAccount := withDefault("QS_SPARK_SA", "spark-operator-spark")
	kubeconfigPath := getenv("KUBECONFIG")

	var clusterDefaultExecutors int32 = 1
	if raw := getenv("QS_CLUSTER_EXECUTORS"); raw != "" {
		n, err := strconv.ParseInt(raw, 10, 32)
		if err == nil {
			clusterDefaultExecutors = int32(n)
		}
		// On bad value: keep default (1). Matches "error or default on bad value" spec.
	}

	// MinIO / S3 settings for Iceberg catalog SparkConf.
	minioEndpoint := withDefault("MINIO_ENDPOINT", "http://minio:9000")
	minioAccessKey := withDefault("MINIO_ROOT_USER", "minioadmin")
	minioSecretKey := withDefault("MINIO_ROOT_PASSWORD", "minioadmin")
	minioRegion := withDefault("MINIO_REGION", "us-east-1")

	// Trino (4c) — all optional with defaults.
	trinoHost := withDefault("TRINO_HOST", "trino")
	trinoPort := withDefault("TRINO_PORT", "8080")
	trinoUser := withDefault("TRINO_USER", "quicksense")
	trinoCatalog := withDefault("TRINO_CATALOG", "iceberg")
	brokerURL := withDefault("BROKER_URL", "http://spark-broker:8099")

	return &Config{
		PostgresHost:     pgHost,
		PostgresUser:     pgUser,
		PostgresPassword: pgPass,
		PostgresPort:     pgPort,
		DSN:              dsn,
		AdminDSN:         adminDSN,

		PolarisHost:         polarisHost,
		PolarisPort:         polarisPort,
		PolarisRealm:        polarisRealm,
		PolarisClientID:     polarisClientID,
		PolarisClientSecret: polarisClientSecret,
		PolarisCatalog:      polarisCatalog,

		KeycloakHost:         kcHost,
		KeycloakPort:         kcPort,
		KeycloakRealm:        kcRealm,
		KeycloakClientID:     kcClientID,
		KeycloakClientSecret: kcClientSecret,
		KeycloakJWKSURL:      jwksURL,
		KeycloakIssuer:       keycloakIssuer,

		RequiredRole: requiredRole,

		SparkImage:              sparkImage,
		SparkConnectNamespace:   sparkNamespace,
		ClusterDefaultExecutors: clusterDefaultExecutors,
		SparkServiceAccount:     sparkServiceAccount,
		KubeconfigPath:          kubeconfigPath,

		MinioEndpoint:  minioEndpoint,
		MinioAccessKey: minioAccessKey,
		MinioSecretKey: minioSecretKey,
		MinioRegion:    minioRegion,

		TrinoHost:    trinoHost,
		TrinoPort:    trinoPort,
		TrinoUser:    trinoUser,
		TrinoCatalog: trinoCatalog,

		BrokerURL: brokerURL,
	}, nil
}
