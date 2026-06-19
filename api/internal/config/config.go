// SPDX-License-Identifier: Apache-2.0

// Package config holds the runtime configuration for the QuickSense API.
// All values are sourced from environment variables; LoadFrom accepts an
// injectable getenv function for testability while Load wraps os.Getenv.
package config

import (
	"errors"
	"fmt"
	"os"
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

	// RequiredRole is the Keycloak role checked on every authenticated request.
	// Default: "polaris_admin".
	RequiredRole string
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

	requiredRole := withDefault("REQUIRED_ROLE", "polaris_admin")

	_ = polarisHost // used by later tasks (polaris.Client base URL)

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

		RequiredRole: requiredRole,
	}, nil
}
