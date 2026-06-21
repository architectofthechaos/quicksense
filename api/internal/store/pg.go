// SPDX-License-Identifier: Apache-2.0

package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

// uniqueViolation is the Postgres error code for a unique_violation.
const uniqueViolation = "23505"

// PgStore is the Postgres-backed implementation of Store.
// It uses a pgxpool.Pool for connection pooling.
type PgStore struct {
	pool *pgxpool.Pool
}

// Ensure PgStore satisfies the Store interface at compile time.
var _ Store = (*PgStore)(nil)

// New opens a pgxpool connection to the given DSN, pings it, and returns a
// ready-to-use *PgStore.
func New(ctx context.Context, dsn string) (*PgStore, error) {
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &PgStore{pool: pool}, nil
}

// Ping verifies the database connection is healthy.
func (s *PgStore) Ping(ctx context.Context) error {
	return s.pool.Ping(ctx)
}

// Close releases all underlying pool connections.
func (s *PgStore) Close() {
	s.pool.Close()
}

// ---- Workspace methods ----

// CreateWorkspace inserts a new workspace row and returns the persisted record.
func (s *PgStore) CreateWorkspace(ctx context.Context, name string) (*Workspace, error) {
	const q = `
		INSERT INTO workspaces (name)
		VALUES ($1)
		RETURNING id, name, created_at, updated_at`

	var w Workspace
	err := s.pool.QueryRow(ctx, q, name).Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, mapPgError(err)
	}
	return &w, nil
}

// GetWorkspace retrieves a workspace by its UUID string.
// Returns ErrNotFound if no row matches.
func (s *PgStore) GetWorkspace(ctx context.Context, id string) (*Workspace, error) {
	const q = `
		SELECT id, name, created_at, updated_at
		FROM workspaces WHERE id = $1`

	var w Workspace
	err := s.pool.QueryRow(ctx, q, id).Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt)
	if err != nil {
		return nil, mapPgError(err)
	}
	return &w, nil
}

// ListWorkspaces returns all workspaces ordered by creation time.
func (s *PgStore) ListWorkspaces(ctx context.Context) ([]Workspace, error) {
	const q = `
		SELECT id, name, created_at, updated_at
		FROM workspaces ORDER BY created_at ASC`

	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()

	var result []Workspace
	for rows.Next() {
		var w Workspace
		if err := rows.Scan(&w.ID, &w.Name, &w.CreatedAt, &w.UpdatedAt); err != nil {
			return nil, err
		}
		result = append(result, w)
	}
	return result, rows.Err()
}

// ---- Cluster methods ----

// clusterColumns is the canonical SELECT/RETURNING column list for clusters,
// in the order scanCluster expects.
const clusterColumns = `id, workspace_id, name, namespace, cr_name, phase,
	COALESCE(connect_url, ''), config, pinned, desired_state, last_activity_at,
	created_at, updated_at`

// scanCluster scans one row (in clusterColumns order) into a *Cluster, mapping
// pgx errors to store sentinels. Works for both QueryRow and a *pgx.Rows cursor.
func scanCluster(row pgx.Row) (*Cluster, error) {
	var c Cluster
	var wsID pgtype.Text
	if err := row.Scan(
		&c.ID, &wsID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
		&c.ConnectURL, &c.Config, &c.Pinned, &c.DesiredState, &c.LastActivityAt,
		&c.CreatedAt, &c.UpdatedAt,
	); err != nil {
		return nil, mapPgError(err)
	}
	if wsID.Valid {
		c.WorkspaceID = wsID.String
	}
	return &c, nil
}

// jsonbArg returns config as a string for a $n::jsonb param, or nil so a
// COALESCE default applies (avoids binding []byte, which pgx encodes as bytea).
func jsonbArg(config json.RawMessage) any {
	if len(config) == 0 {
		return nil
	}
	return string(config)
}

// CreateCluster inserts a new cluster record and returns it.
// Maps unique-constraint violations (cr_name or workspace_id+name) to ErrConflict.
// When p.WorkspaceID is empty, SQL NULL is bound so Postgres does not reject
// the empty string as an invalid UUID (error code 22P02).
func (s *PgStore) CreateCluster(ctx context.Context, p CreateClusterParams) (*Cluster, error) {
	q := `INSERT INTO clusters (workspace_id, name, namespace, cr_name, config)
		VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb))
		RETURNING ` + clusterColumns

	var workspaceID any
	if p.WorkspaceID != "" {
		workspaceID = p.WorkspaceID
	} // nil → SQL NULL

	return scanCluster(s.pool.QueryRow(ctx, q, workspaceID, p.Name, p.Namespace, p.CRName, jsonbArg(p.Config)))
}

// GetCluster retrieves a cluster by its UUID string.
// Returns ErrNotFound if no row matches.
func (s *PgStore) GetCluster(ctx context.Context, id string) (*Cluster, error) {
	q := `SELECT ` + clusterColumns + ` FROM clusters WHERE id = $1`
	return scanCluster(s.pool.QueryRow(ctx, q, id))
}

// ListClusters returns all clusters ordered by creation time.
func (s *PgStore) ListClusters(ctx context.Context) ([]Cluster, error) {
	q := `SELECT ` + clusterColumns + ` FROM clusters ORDER BY created_at ASC`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()

	var result []Cluster
	for rows.Next() {
		c, err := scanCluster(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *c)
	}
	return result, rows.Err()
}

// UpdateClusterPhase sets a new phase and optional connect URL on a cluster.
// Returns ErrNotFound if no row matches.
func (s *PgStore) UpdateClusterPhase(ctx context.Context, id string, phase ClusterPhase, connectURL string) (*Cluster, error) {
	q := `UPDATE clusters SET phase = $2, connect_url = NULLIF($3, ''), updated_at = now()
		WHERE id = $1 RETURNING ` + clusterColumns
	return scanCluster(s.pool.QueryRow(ctx, q, id, string(phase), connectURL))
}

// UpdateClusterConfig replaces the persisted create config (for PATCH/edit).
func (s *PgStore) UpdateClusterConfig(ctx context.Context, id string, config json.RawMessage) (*Cluster, error) {
	q := `UPDATE clusters SET config = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING ` + clusterColumns
	return scanCluster(s.pool.QueryRow(ctx, q, id, string(config)))
}

// SetClusterDesiredState records Start/Stop intent ("Running" | "Stopped").
func (s *PgStore) SetClusterDesiredState(ctx context.Context, id, desiredState string) (*Cluster, error) {
	q := `UPDATE clusters SET desired_state = $2, updated_at = now() WHERE id = $1 RETURNING ` + clusterColumns
	return scanCluster(s.pool.QueryRow(ctx, q, id, desiredState))
}

// SetClusterPinned toggles the pin flag (exclude from idle auto-terminate).
func (s *PgStore) SetClusterPinned(ctx context.Context, id string, pinned bool) (*Cluster, error) {
	q := `UPDATE clusters SET pinned = $2, updated_at = now() WHERE id = $1 RETURNING ` + clusterColumns
	return scanCluster(s.pool.QueryRow(ctx, q, id, pinned))
}

// TouchClusterActivity bumps last_activity_at (called on attach/run/lifecycle).
func (s *PgStore) TouchClusterActivity(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE clusters SET last_activity_at = now() WHERE id = $1`, id)
	if err != nil {
		return mapPgError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteCluster removes a cluster by ID.
// Returns ErrNotFound if no row matches.
func (s *PgStore) DeleteCluster(ctx context.Context, id string) error {
	const q = `DELETE FROM clusters WHERE id = $1`
	tag, err := s.pool.Exec(ctx, q, id)
	if err != nil {
		return mapPgError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// mapPgError translates pgx-level errors to store-level sentinel errors.
//
//   - pgx.ErrNoRows → ErrNotFound
//   - Postgres 23505 (unique_violation) → ErrConflict
//   - everything else passes through unchanged
func mapPgError(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrNotFound
	}
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == uniqueViolation {
		return ErrConflict
	}
	return err
}
