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
	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/keycloak"
	"github.com/deepiq/quicksense/api/internal/polaris"
	"github.com/deepiq/quicksense/api/internal/store"
	"github.com/deepiq/quicksense/api/internal/trino"
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
	// The issuer comes from config (KEYCLOAK_ISSUER override, or host/port/realm-
	// derived by default). JWKS is always fetched from cfg.KeycloakJWKSURL, so the
	// two may differ when browser-minted tokens carry a different issuer host
	// (e.g. localhost:8082) than the in-cluster JWKS fetch host (keycloak:8082).
	issuer := cfg.KeycloakIssuer
	v, err := auth.NewKeycloakVerifier(ctx, cfg.KeycloakJWKSURL, issuer, cfg.RequiredRole)
	if err != nil {
		log.Fatalf("quicksense-api: keycloak verifier: %v", err)
	}
	log.Printf("quicksense-api: keycloak verifier ready (issuer=%s, role=%s)", issuer, cfg.RequiredRole)

	// ── 7. k8s dynamic client + SparkConnect client ───────────────────────────
	dyn, err := k8s.NewDynamicClient(cfg.KubeconfigPath)
	if err != nil {
		log.Fatalf("quicksense-api: k8s client: %v", err)
	}
	clientset, err := k8s.NewClientset(cfg.KubeconfigPath)
	if err != nil {
		log.Fatalf("quicksense-api: k8s clientset: %v", err)
	}
	scc := k8s.NewSparkConnectClientWithClientset(dyn, clientset, cfg.SparkConnectNamespace)
	log.Printf("quicksense-api: k8s SparkConnect client ready (namespace=%s, image=%s, executors=%d)",
		cfg.SparkConnectNamespace, cfg.SparkImage, cfg.ClusterDefaultExecutors)

	// ── 8. Router ─────────────────────────────────────────────────────────────
	r := httpapi.NewRouter(httpapi.RouterDeps{
		Verifier:       v,
		Polaris:        pc,
		Store:          st,
		K8s:            scc,
		Namespace:      cfg.SparkConnectNamespace,
		DefaultExec:    cfg.ClusterDefaultExecutors,
		SparkImage:     cfg.SparkImage,
		ServiceAccount: cfg.SparkServiceAccount,
		SparkConf:      cfg.CatalogSparkConf(),
		Trino:          trino.NewHTTPClient(fmt.Sprintf("http://%s:%s", cfg.TrinoHost, cfg.TrinoPort), cfg.TrinoUser, &http.Client{Timeout: 30 * time.Second}),
		TrinoCatalog:   cfg.TrinoCatalog,
		KeycloakAdmin: keycloak.NewHTTPAdminClient(
			fmt.Sprintf("http://%s:%s", cfg.KeycloakHost, cfg.KeycloakPort),
			cfg.KeycloakRealm, cfg.KeycloakClientID, cfg.KeycloakClientSecret,
			&http.Client{Timeout: 30 * time.Second}),
	})

	// Idle auto-terminate: periodically stop Running, unpinned clusters past
	// their configured idle window (server-side enforcement; pin excludes).
	go httpapi.NewIdleReconciler(st, scc).Start(ctx, time.Minute)

	// ── 9. Serve ──────────────────────────────────────────────────────────────
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
