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
	COALESCE(connect_url, ''), config, pinned, desired_state, last_activity_at, owner,
	created_at, updated_at`

// scanCluster scans one row (in clusterColumns order) into a *Cluster, mapping
// pgx errors to store sentinels. Works for both QueryRow and a *pgx.Rows cursor.
func scanCluster(row pgx.Row) (*Cluster, error) {
	var c Cluster
	var wsID pgtype.Text
	if err := row.Scan(
		&c.ID, &wsID, &c.Name, &c.Namespace, &c.CRName, &c.Phase,
		&c.ConnectURL, &c.Config, &c.Pinned, &c.DesiredState, &c.LastActivityAt, &c.Owner,
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
	q := `INSERT INTO clusters (workspace_id, name, namespace, cr_name, config, owner)
		VALUES ($1, $2, $3, $4, COALESCE($5::jsonb, '{}'::jsonb), $6)
		RETURNING ` + clusterColumns

	var workspaceID any
	if p.WorkspaceID != "" {
		workspaceID = p.WorkspaceID
	} // nil → SQL NULL

	return scanCluster(s.pool.QueryRow(ctx, q, workspaceID, p.Name, p.Namespace, p.CRName, jsonbArg(p.Config), p.Owner))
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

// ---- Notebook methods (4d) ----

const notebookColumns = `id, COALESCE(folder_id::text, ''), name, path, owner, content,
	COALESCE(attached_cluster_id::text, ''), trashed_at, created_at, updated_at`

func scanNotebook(row pgx.Row) (*Notebook, error) {
	var n Notebook
	if err := row.Scan(
		&n.ID, &n.FolderID, &n.Name, &n.Path, &n.Owner, &n.Content,
		&n.AttachedClusterID, &n.TrashedAt, &n.CreatedAt, &n.UpdatedAt,
	); err != nil {
		return nil, mapPgError(err)
	}
	return &n, nil
}

const revisionColumns = `id, notebook_id, snapshot, message, author, created_at`

func scanRevision(row pgx.Row) (*NotebookRevision, error) {
	var r NotebookRevision
	if err := row.Scan(&r.ID, &r.NotebookID, &r.Snapshot, &r.Message, &r.Author, &r.CreatedAt); err != nil {
		return nil, mapPgError(err)
	}
	return &r, nil
}

// CreateNotebook inserts a notebook (empty cells by default).
func (s *PgStore) CreateNotebook(ctx context.Context, p CreateNotebookParams) (*Notebook, error) {
	q := `INSERT INTO notebooks (folder_id, name, path, owner, content)
		VALUES (NULLIF($1, '')::uuid, $2, $3, $4, COALESCE($5::jsonb, '{"cells":[]}'::jsonb))
		RETURNING ` + notebookColumns
	return scanNotebook(s.pool.QueryRow(ctx, q, p.FolderID, p.Name, p.Path, p.Owner, jsonbArg(p.Content)))
}

// GetNotebook returns a notebook by ID (ErrNotFound if absent).
func (s *PgStore) GetNotebook(ctx context.Context, id string) (*Notebook, error) {
	q := `SELECT ` + notebookColumns + ` FROM notebooks WHERE id = $1`
	return scanNotebook(s.pool.QueryRow(ctx, q, id))
}

// ListNotebooks returns all non-trashed notebooks ordered by path.
func (s *PgStore) ListNotebooks(ctx context.Context) ([]Notebook, error) {
	q := `SELECT ` + notebookColumns + ` FROM notebooks WHERE trashed_at IS NULL ORDER BY path ASC`
	rows, err := s.pool.Query(ctx, q)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()
	var result []Notebook
	for rows.Next() {
		n, err := scanNotebook(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *n)
	}
	return result, rows.Err()
}

// UpdateNotebookContent replaces the cell content (on save).
func (s *PgStore) UpdateNotebookContent(ctx context.Context, id string, content json.RawMessage) (*Notebook, error) {
	q := `UPDATE notebooks SET content = $2::jsonb, updated_at = now() WHERE id = $1 RETURNING ` + notebookColumns
	return scanNotebook(s.pool.QueryRow(ctx, q, id, string(content)))
}

// AttachNotebookCluster sets (or clears, when empty) the attached cluster.
func (s *PgStore) AttachNotebookCluster(ctx context.Context, id, clusterID string) (*Notebook, error) {
	q := `UPDATE notebooks SET attached_cluster_id = NULLIF($2, '')::uuid, updated_at = now()
		WHERE id = $1 RETURNING ` + notebookColumns
	return scanNotebook(s.pool.QueryRow(ctx, q, id, clusterID))
}

// TrashNotebook soft-deletes a notebook.
func (s *PgStore) TrashNotebook(ctx context.Context, id string) error {
	tag, err := s.pool.Exec(ctx, `UPDATE notebooks SET trashed_at = now() WHERE id = $1`, id)
	if err != nil {
		return mapPgError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateRevision saves a content snapshot for version history.
func (s *PgStore) CreateRevision(ctx context.Context, notebookID string, snapshot json.RawMessage, message, author string) (*NotebookRevision, error) {
	q := `INSERT INTO notebook_revisions (notebook_id, snapshot, message, author)
		VALUES ($1::uuid, $2::jsonb, $3, $4) RETURNING ` + revisionColumns
	return scanRevision(s.pool.QueryRow(ctx, q, notebookID, string(snapshot), message, author))
}

// ListRevisions returns a notebook's revisions, newest first.
func (s *PgStore) ListRevisions(ctx context.Context, notebookID string) ([]NotebookRevision, error) {
	q := `SELECT ` + revisionColumns + ` FROM notebook_revisions WHERE notebook_id = $1 ORDER BY created_at DESC`
	rows, err := s.pool.Query(ctx, q, notebookID)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()
	var result []NotebookRevision
	for rows.Next() {
		r, err := scanRevision(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *r)
	}
	return result, rows.Err()
}

// GetRevision returns a single revision by ID (for restore).
func (s *PgStore) GetRevision(ctx context.Context, revID string) (*NotebookRevision, error) {
	q := `SELECT ` + revisionColumns + ` FROM notebook_revisions WHERE id = $1`
	return scanRevision(s.pool.QueryRow(ctx, q, revID))
}

// ---- Permission methods (4e) ----

const permissionColumns = `object_type, object_id, principal_type, principal_id, level, granted_by, created_at`

func scanPermission(row pgx.Row) (*Permission, error) {
	var p Permission
	if err := row.Scan(&p.ObjectType, &p.ObjectID, &p.PrincipalType, &p.PrincipalID, &p.Level, &p.GrantedBy, &p.CreatedAt); err != nil {
		return nil, mapPgError(err)
	}
	return &p, nil
}

// GrantPermission upserts a grant on (object, principal), replacing the level.
func (s *PgStore) GrantPermission(ctx context.Context, p GrantParams) (*Permission, error) {
	q := `INSERT INTO permissions (object_type, object_id, principal_type, principal_id, level, granted_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (object_type, object_id, principal_type, principal_id)
		DO UPDATE SET level = EXCLUDED.level, granted_by = EXCLUDED.granted_by
		RETURNING ` + permissionColumns
	return scanPermission(s.pool.QueryRow(ctx, q, p.ObjectType, p.ObjectID, p.PrincipalType, p.PrincipalID, p.Level, p.GrantedBy))
}

// RevokePermission removes a principal's grant on an object (ErrNotFound if absent).
func (s *PgStore) RevokePermission(ctx context.Context, objectType, objectID, principalType, principalID string) error {
	tag, err := s.pool.Exec(ctx,
		`DELETE FROM permissions WHERE object_type=$1 AND object_id=$2 AND principal_type=$3 AND principal_id=$4`,
		objectType, objectID, principalType, principalID)
	if err != nil {
		return mapPgError(err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListPermissions returns all grants on an object.
func (s *PgStore) ListPermissions(ctx context.Context, objectType, objectID string) ([]Permission, error) {
	q := `SELECT ` + permissionColumns + ` FROM permissions WHERE object_type=$1 AND object_id=$2 ORDER BY principal_type, principal_id`
	rows, err := s.pool.Query(ctx, q, objectType, objectID)
	if err != nil {
		return nil, mapPgError(err)
	}
	defer rows.Close()
	var result []Permission
	for rows.Next() {
		p, err := scanPermission(rows)
		if err != nil {
			return nil, err
		}
		result = append(result, *p)
	}
	return result, rows.Err()
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
