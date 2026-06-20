// SPDX-License-Identifier: Apache-2.0

// Command quicksense-api is the QuickSense control-plane HTTP server.
//
// Start-up sequence:
//  1. Load configuration from environment variables (see internal/config).
//  2. Ensure the QUICKSENSE database exists (CREATE DATABASE idempotent).
//  3. Run pending SQL migrations (embedded; idempotent via golang-migrate).
//  4. Open the connection pool to QUICKSENSE.
//  5. Build the Polaris REST proxy client.
//  6. Build the Keycloak JWT verifier (background-refreshing JWKS cache).
//  7. Mount the chi router with all dependencies injected.
//  8. Serve on :8080.
package main

import (
	"context"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/config"
	httpapi "github.com/deepiq/quicksense/api/internal/http"
	"github.com/deepiq/quicksense/api/internal/polaris"
	"github.com/deepiq/quicksense/api/internal/store"
)

func main() {
	// Signal-aware context so the JWKS background goroutine shuts down cleanly.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	// ── 1. Config ─────────────────────────────────────────────────────────────
	cfg, err := config.Load()
	if err != nil {
		log.Fatalf("quicksense-api: config error: %v", err)
	}
	log.Println("quicksense-api: configuration loaded")

	// ── 2. Ensure database ────────────────────────────────────────────────────
	// The application database is always named QUICKSENSE (global-constraints §2).
	// cfg.DSN already encodes this name; we pass the literal so EnsureDatabase
	// can quote it correctly for CREATE DATABASE.
	const dbName = "QUICKSENSE"
	if err := store.EnsureDatabase(ctx, cfg.AdminDSN, dbName); err != nil {
		log.Fatalf("quicksense-api: EnsureDatabase: %v", err)
	}
	log.Printf("quicksense-api: database %q is ready", dbName)

	// ── 3. Migrate ────────────────────────────────────────────────────────────
	if err := store.Migrate(cfg.DSN); err != nil {
		log.Fatalf("quicksense-api: migrate: %v", err)
	}
	log.Println("quicksense-api: migrations applied")

	// ── 4. Open store ─────────────────────────────────────────────────────────
	st, err := store.New(ctx, cfg.DSN)
	if err != nil {
		log.Fatalf("quicksense-api: store.New: %v", err)
	}
	defer st.Close()
	log.Println("quicksense-api: postgres store connected")

	// ── 5. Polaris client ─────────────────────────────────────────────────────
	polarisBaseURL := fmt.Sprintf("http://%s:%s", cfg.PolarisHost, cfg.PolarisPort)
	pc, err := polaris.NewHTTPClient(
		polarisBaseURL,
		cfg.PolarisRealm,
		cfg.PolarisClientID,
		cfg.PolarisClientSecret,
		&http.Client{Timeout: 30 * time.Second},
	)
	if err != nil {
		log.Fatalf("quicksense-api: polaris client: %v", err)
	}
	log.Printf("quicksense-api: polaris client targeting %s", polarisBaseURL)

	// ── 6. Keycloak JWT verifier ──────────────────────────────────────────────
	// Derive the issuer from host/port/realm; cfg.KeycloakJWKSURL is pre-built
	// with the same components so the two values are always consistent.
	issuer := fmt.Sprintf("http://%s:%s/realms/%s",
		cfg.KeycloakHost, cfg.KeycloakPort, cfg.KeycloakRealm)
	v, err := auth.NewKeycloakVerifier(ctx, cfg.KeycloakJWKSURL, issuer, cfg.RequiredRole)
	if err != nil {
		log.Fatalf("quicksense-api: keycloak verifier: %v", err)
	}
	log.Printf("quicksense-api: keycloak verifier ready (issuer=%s, role=%s)", issuer, cfg.RequiredRole)

	// ── 7. Router ─────────────────────────────────────────────────────────────
	r := httpapi.NewRouter(httpapi.RouterDeps{
		Verifier: v,
		Polaris:  pc,
		Store:    st,
	})

	// ── 8. Serve ──────────────────────────────────────────────────────────────
	srv := &http.Server{
		Addr:         ":8080",
		Handler:      r,
		ReadTimeout:  30 * time.Second,
		WriteTimeout: 60 * time.Second,
		IdleTimeout:  120 * time.Second,
	}

	log.Println("quicksense-api: listening on :8080")
	if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatalf("quicksense-api: server error: %v", err)
	}
}
