// SPDX-License-Identifier: Apache-2.0

package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
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

// CreateCluster inserts a new cluster record and returns it.
// Maps unique-constraint violations (cr_name or workspace_id+name) to ErrConflict.
func (s *PgStore) CreateCluster(ctx context.Context, p CreateClusterParams) (*Cluster, error) {
	const q = `
		INSERT INTO clusters (workspace_id, name, namespace, cr_name)
		VALUES ($1, $2, $3, $4)
		RETURNING id, workspace_id, name, namespace, cr_name, phase,
		          COALESCE(connect_url, ''), created_at, updated_at`

	var c Cluster
	err := s.pool.QueryRow(ctx, q,
		p.WorkspaceID, p.Name, p.Namespace, p.CRName,
	).Scan(
		&c.ID, &c.WorkspaceID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
		&c.ConnectURL, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, mapPgError(err)
	}
	return &c, nil
}

// GetCluster retrieves a cluster by its UUID string.
// Returns ErrNotFound if no row matches.
func (s *PgStore) GetCluster(ctx context.Context, id string) (*Cluster, error) {
	const q = `
		SELECT id, workspace_id, name, namespace, cr_name, phase,
		       COALESCE(connect_url, ''), created_at, updated_at
		FROM clusters WHERE id = $1`

	var c Cluster
	err := s.pool.QueryRow(ctx, q, id).Scan(
		&c.ID, &c.WorkspaceID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
		&c.ConnectURL, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, mapPgError(err)
	}
	return &c, nil
}

// ListClusters returns all clusters ordered by creation time.
func (s *PgStore) ListClusters(ctx context.Context) ([]Cluster, error) {
	const q = `
		SELECT id, workspace_id, name, namespace, cr_name, phase,
		       COALESCE(connect_url, ''), created_at, updated_at
		FROM clusters ORDER BY created_at ASC`

	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()

	var result []Cluster
	for rows.Next() {
		var c Cluster
		if err := rows.Scan(
			&c.ID, &c.WorkspaceID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
			&c.ConnectURL, &c.CreatedAt, &c.UpdatedAt,
		); err != nil {
			return nil, err
		}
		result = append(result, c)
	}
	return result, rows.Err()
}

// UpdateClusterPhase sets a new phase and optional connect URL on a cluster.
// Returns ErrNotFound if no row matches.
func (s *PgStore) UpdateClusterPhase(ctx context.Context, id string, phase ClusterPhase, connectURL string) (*Cluster, error) {
	const q = `
		UPDATE clusters
		SET phase = $2, connect_url = NULLIF($3, ''), updated_at = now()
		WHERE id = $1
		RETURNING id, workspace_id, name, namespace, cr_name, phase,
		          COALESCE(connect_url, ''), created_at, updated_at`

	var c Cluster
	err := s.pool.QueryRow(ctx, q, id, string(phase), connectURL).Scan(
		&c.ID, &c.WorkspaceID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
		&c.ConnectURL, &c.CreatedAt, &c.UpdatedAt,
	)
	if err != nil {
		return nil, mapPgError(err)
	}
	return &c, nil
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
