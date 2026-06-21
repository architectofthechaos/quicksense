// SPDX-License-Identifier: Apache-2.0

// Package store_test contains hermetic (non-integration) tests for the store package.
// These tests run with the default `go test ./...` and do not require a live database.
package store_test

import (
	"io/fs"
	"strings"
	"testing"

	"github.com/deepiq/quicksense/api/internal/store"
)

// TestEmbeddedMigrationsPresent verifies that the embedded migration FS
// contains the expected up and down SQL files.
func TestEmbeddedMigrationsPresent(t *testing.T) {
	files := []string{
		"migrations/0001_init.up.sql",
		"migrations/0001_init.down.sql",
	}
	for _, f := range files {
		data, err := fs.ReadFile(store.MigrationsFS, f)
		if err != nil {
			t.Fatalf("expected embedded file %q: %v", f, err)
		}
		if len(data) == 0 {
			t.Errorf("embedded file %q is empty", f)
		}
	}
}

// TestUpMigrationContainsExpectedStatements checks the key SQL statements in the
// up migration without executing them.
func TestUpMigrationContainsExpectedStatements(t *testing.T) {
	data, err := fs.ReadFile(store.MigrationsFS, "migrations/0001_init.up.sql")
	if err != nil {
		t.Fatalf("reading up migration: %v", err)
	}
	sql := string(data)

	checks := []struct {
		label   string
		needle  string
	}{
		{"CREATE TABLE workspaces", "CREATE TABLE workspaces"},
		{"CREATE TABLE clusters", "CREATE TABLE clusters"},
		{"clusters_ws_name_uniq unique index", "clusters_ws_name_uniq"},
		{"pgcrypto extension", "pgcrypto"},
	}
	for _, c := range checks {
		if !strings.Contains(sql, c.needle) {
			t.Errorf("up migration missing %q (needle: %q)", c.label, c.needle)
		}
	}
}

// TestDownMigrationContainsExpectedStatements checks the down migration drops both tables.
func TestDownMigrationContainsExpectedStatements(t *testing.T) {
	data, err := fs.ReadFile(store.MigrationsFS, "migrations/0001_init.down.sql")
	if err != nil {
		t.Fatalf("reading down migration: %v", err)
	}
	sql := string(data)

	checks := []struct {
		label  string
		needle string
	}{
		{"DROP TABLE clusters", "clusters"},
		{"DROP TABLE workspaces", "workspaces"},
	}
	for _, c := range checks {
		if !strings.Contains(sql, c.needle) {
			t.Errorf("down migration missing %q (needle: %q)", c.label, c.needle)
		}
	}
}

// TestMigration0002AddsClusterConfig verifies the 4b migration is embedded and
// adds the config/lifecycle columns.
func TestMigration0002AddsClusterConfig(t *testing.T) {
	for _, f := range []string{
		"migrations/0002_clusters_config.up.sql",
		"migrations/0002_clusters_config.down.sql",
	} {
		data, err := fs.ReadFile(store.MigrationsFS, f)
		if err != nil {
			t.Fatalf("expected embedded file %q: %v", f, err)
		}
		if len(data) == 0 {
			t.Errorf("embedded file %q is empty", f)
		}
	}
	up, err := fs.ReadFile(store.MigrationsFS, "migrations/0002_clusters_config.up.sql")
	if err != nil {
		t.Fatalf("reading 0002 up: %v", err)
	}
	for _, col := range []string{"config", "pinned", "desired_state", "last_activity_at"} {
		if !strings.Contains(string(up), col) {
			t.Errorf("0002 up migration missing column %q", col)
		}
	}
}

// TestMigration0003AddsNotebooks verifies the 4d notebooks migration is embedded
// and creates the folders/notebooks/notebook_revisions tables.
func TestMigration0003AddsNotebooks(t *testing.T) {
	for _, f := range []string{
		"migrations/0003_notebooks.up.sql",
		"migrations/0003_notebooks.down.sql",
	} {
		data, err := fs.ReadFile(store.MigrationsFS, f)
		if err != nil {
			t.Fatalf("expected embedded file %q: %v", f, err)
		}
		if len(data) == 0 {
			t.Errorf("embedded file %q is empty", f)
		}
	}
	up, err := fs.ReadFile(store.MigrationsFS, "migrations/0003_notebooks.up.sql")
	if err != nil {
		t.Fatalf("reading 0003 up: %v", err)
	}
	for _, tbl := range []string{"CREATE TABLE folders", "CREATE TABLE notebooks", "CREATE TABLE notebook_revisions"} {
		if !strings.Contains(string(up), tbl) {
			t.Errorf("0003 up migration missing %q", tbl)
		}
	}
}
