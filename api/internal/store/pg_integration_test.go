//go:build integration

// SPDX-License-Identifier: Apache-2.0

// Package store_test provides an integration test for PgStore using testcontainers.
// Run with: go test -tags=integration ./internal/store/... -v
package store_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	tcpostgres "github.com/testcontainers/testcontainers-go/modules/postgres"

	"github.com/deepiq/quicksense/api/internal/store"
)

// TestPgStoreIntegration exercises the full PgStore against a real ephemeral postgres:16.
func TestPgStoreIntegration(t *testing.T) {
	ctx := context.Background()

	// Spin up ephemeral postgres:16-alpine container.
	pgCtr, err := tcpostgres.Run(ctx,
		"postgres:16-alpine",
		tcpostgres.WithUsername("testuser"),
		tcpostgres.WithPassword("testpass"),
		tcpostgres.WithDatabase("postgres"),
		tcpostgres.BasicWaitStrategies(),
	)
	if err != nil {
		t.Fatalf("starting postgres container: %v", err)
	}
	t.Cleanup(func() {
		if err := pgCtr.Terminate(ctx); err != nil {
			t.Logf("terminating postgres container: %v", err)
		}
	})

	adminDSN, err := pgCtr.ConnectionString(ctx, "sslmode=disable")
	if err != nil {
		t.Fatalf("getting admin DSN: %v", err)
	}

	const dbName = "QUICKSENSE"

	// --- EnsureDatabase ---
	if err := store.EnsureDatabase(ctx, adminDSN, dbName); err != nil {
		t.Fatalf("EnsureDatabase: %v", err)
	}
	// Idempotent — should not error on second call.
	if err := store.EnsureDatabase(ctx, adminDSN, dbName); err != nil {
		t.Fatalf("EnsureDatabase (idempotent): %v", err)
	}

	// Build the app DSN pointing at the new QUICKSENSE database.
	// adminDSN is postgres://testuser:testpass@host:port/postgres?sslmode=disable
	appDSN := replaceDBInDSN(adminDSN, "postgres", dbName)

	// --- Migrate ---
	if err := store.Migrate(appDSN); err != nil {
		t.Fatalf("Migrate: %v", err)
	}
	// Idempotent — ErrNoChange should be suppressed.
	if err := store.Migrate(appDSN); err != nil {
		t.Fatalf("Migrate (idempotent): %v", err)
	}

	// --- New ---
	st, err := store.New(ctx, appDSN)
	if err != nil {
		t.Fatalf("store.New: %v", err)
	}
	defer st.Close()

	// --- Ping ---
	if err := st.Ping(ctx); err != nil {
		t.Fatalf("Ping: %v", err)
	}

	// ====== Workspace CRUD ======

	// CreateWorkspace
	ws, err := st.CreateWorkspace(ctx, "test-workspace")
	if err != nil {
		t.Fatalf("CreateWorkspace: %v", err)
	}
	if ws.ID == "" {
		t.Error("CreateWorkspace: expected non-empty ID")
	}
	if ws.Name != "test-workspace" {
		t.Errorf("CreateWorkspace: name = %q, want %q", ws.Name, "test-workspace")
	}
	if ws.CreatedAt.IsZero() {
		t.Error("CreateWorkspace: expected non-zero CreatedAt")
	}

	// GetWorkspace
	got, err := st.GetWorkspace(ctx, ws.ID)
	if err != nil {
		t.Fatalf("GetWorkspace: %v", err)
	}
	if got.ID != ws.ID {
		t.Errorf("GetWorkspace: ID = %q, want %q", got.ID, ws.ID)
	}

	// GetWorkspace — not found
	_, err = st.GetWorkspace(ctx, "00000000-0000-0000-0000-000000000000")
	if !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetWorkspace(missing): got %v, want ErrNotFound", err)
	}

	// ListWorkspaces
	list, err := st.ListWorkspaces(ctx)
	if err != nil {
		t.Fatalf("ListWorkspaces: %v", err)
	}
	if len(list) != 1 {
		t.Errorf("ListWorkspaces: got %d, want 1", len(list))
	}

	// ====== Cluster CRUD ======

	p := store.CreateClusterParams{
		WorkspaceID: ws.ID,
		Name:        "test-cluster",
		Namespace:   "spark",
		CRName:      "sc-test-abc123",
	}

	// CreateCluster
	cl, err := st.CreateCluster(ctx, p)
	if err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	if cl.ID == "" {
		t.Error("CreateCluster: expected non-empty ID")
	}
	if cl.Phase != store.ClusterPhasePending {
		t.Errorf("CreateCluster: phase = %q, want %q", cl.Phase, store.ClusterPhasePending)
	}
	if cl.WorkspaceID != ws.ID {
		t.Errorf("CreateCluster: workspaceID = %q, want %q", cl.WorkspaceID, ws.ID)
	}

	// GetCluster
	got2, err := st.GetCluster(ctx, cl.ID)
	if err != nil {
		t.Fatalf("GetCluster: %v", err)
	}
	if got2.ID != cl.ID {
		t.Errorf("GetCluster: ID = %q, want %q", got2.ID, cl.ID)
	}

	// ListClusters
	cls, err := st.ListClusters(ctx)
	if err != nil {
		t.Fatalf("ListClusters: %v", err)
	}
	if len(cls) != 1 {
		t.Errorf("ListClusters: got %d, want 1", len(cls))
	}

	// UpdateClusterPhase
	updated, err := st.UpdateClusterPhase(ctx, cl.ID, store.ClusterPhaseRunning, "spark://localhost:15002")
	if err != nil {
		t.Fatalf("UpdateClusterPhase: %v", err)
	}
	if updated.Phase != store.ClusterPhaseRunning {
		t.Errorf("UpdateClusterPhase: phase = %q, want Running", updated.Phase)
	}
	if updated.ConnectURL != "spark://localhost:15002" {
		t.Errorf("UpdateClusterPhase: connectURL = %q, want spark://localhost:15002", updated.ConnectURL)
	}

	// Verify phase persisted via GetCluster.
	got3, err := st.GetCluster(ctx, cl.ID)
	if err != nil {
		t.Fatalf("GetCluster (after update): %v", err)
	}
	if got3.Phase != store.ClusterPhaseRunning {
		t.Errorf("GetCluster (after update): phase = %q, want Running", got3.Phase)
	}

	// UpdateClusterPhase — not found
	_, err = st.UpdateClusterPhase(ctx, "00000000-0000-0000-0000-000000000000", store.ClusterPhaseFailed, "")
	if !errors.Is(err, store.ErrNotFound) {
		t.Errorf("UpdateClusterPhase(missing): got %v, want ErrNotFound", err)
	}

	// DeleteCluster
	if err := st.DeleteCluster(ctx, cl.ID); err != nil {
		t.Fatalf("DeleteCluster: %v", err)
	}

	// GetCluster after delete — should be ErrNotFound
	_, err = st.GetCluster(ctx, cl.ID)
	if !errors.Is(err, store.ErrNotFound) {
		t.Errorf("GetCluster (after delete): got %v, want ErrNotFound", err)
	}

	// DeleteCluster — not found
	if err := st.DeleteCluster(ctx, cl.ID); !errors.Is(err, store.ErrNotFound) {
		t.Errorf("DeleteCluster(missing): got %v, want ErrNotFound", err)
	}

	// ====== ErrConflict — duplicate cr_name ======

	p2 := store.CreateClusterParams{
		WorkspaceID: ws.ID,
		Name:        "cluster-a",
		Namespace:   "spark",
		CRName:      "sc-unique-crname",
	}
	_, err = st.CreateCluster(ctx, p2)
	if err != nil {
		t.Fatalf("CreateCluster (conflict setup): %v", err)
	}

	p3 := store.CreateClusterParams{
		WorkspaceID: ws.ID,
		Name:        "cluster-b",
		Namespace:   "spark",
		CRName:      "sc-unique-crname", // duplicate cr_name — must → ErrConflict
	}
	_, err = st.CreateCluster(ctx, p3)
	if !errors.Is(err, store.ErrConflict) {
		t.Errorf("CreateCluster (duplicate cr_name): got %v, want ErrConflict", err)
	}
}

// replaceDBInDSN swaps the database name in a postgres DSN.
// DSN format: postgres://user:pass@host:port/dbname?options
func replaceDBInDSN(dsn, oldDB, newDB string) string {
	return strings.Replace(dsn, "/"+oldDB+"?", "/"+newDB+"?", 1)
}
