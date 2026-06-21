// SPDX-License-Identifier: Apache-2.0

// Package store defines the persistence contract for the QuickSense API.
// It contains domain types, sentinel errors, and the Store interface.
// The concrete implementation is PgStore (pg.go); migrations live in migrate.go.
package store

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

// ClusterPhase represents the lifecycle state of a SparkConnect cluster.
type ClusterPhase string

const (
	ClusterPhasePending ClusterPhase = "Pending"
	ClusterPhaseRunning ClusterPhase = "Running"
	ClusterPhaseFailed  ClusterPhase = "Failed"
	ClusterPhaseDeleted ClusterPhase = "Deleted"
)

// Workspace is a logical grouping of clusters.
type Workspace struct {
	ID        string
	Name      string
	CreatedAt time.Time
	UpdatedAt time.Time
}

// Cluster is a SparkConnect cluster record stored in Postgres.
type Cluster struct {
	ID             string
	WorkspaceID    string
	Name           string
	Namespace      string
	CRName         string
	Phase          ClusterPhase
	ConnectURL     string
	Config         json.RawMessage // 4b: persisted create config (workers/resources/conf/env/tags/idle)
	Pinned         bool            // 4b: excluded from idle auto-terminate
	DesiredState   string          // 4b: "Running" | "Stopped"
	LastActivityAt time.Time       // 4b: bumped on attach/run/lifecycle; drives idle reconcile
	CreatedAt      time.Time
	UpdatedAt      time.Time
}

// CreateClusterParams carries the input required to create a new cluster record.
type CreateClusterParams struct {
	WorkspaceID string
	Name        string
	Namespace   string
	CRName      string
	Config      json.RawMessage // full create config, persisted for lifecycle re-rendering
}

// Notebook is a workspace notebook (source + metadata) stored in Postgres (4d).
type Notebook struct {
	ID                string
	FolderID          string
	Name              string
	Path              string
	Owner             string
	Content           json.RawMessage // {"cells":[...]}
	AttachedClusterID string
	TrashedAt         *time.Time
	CreatedAt         time.Time
	UpdatedAt         time.Time
}

// CreateNotebookParams carries the input to create a notebook.
type CreateNotebookParams struct {
	Name     string
	Path     string
	Owner    string
	FolderID string
	Content  json.RawMessage
}

// NotebookRevision is a saved snapshot of a notebook's content (version history).
type NotebookRevision struct {
	ID         string
	NotebookID string
	Snapshot   json.RawMessage
	Message    string
	Author     string
	CreatedAt  time.Time
}

// ErrNotFound is returned when a requested resource does not exist in the store.
var ErrNotFound = errors.New("not found")

// ErrConflict is returned when an insert violates a uniqueness constraint.
var ErrConflict = errors.New("already exists")

// Store is the persistence interface consumed by HTTP handlers and the compute planner.
type Store interface {
	// Ping verifies the database connection is healthy.
	Ping(ctx context.Context) error
	// Close releases all underlying connections.
	Close()

	// Workspace methods.
	CreateWorkspace(ctx context.Context, name string) (*Workspace, error)
	GetWorkspace(ctx context.Context, id string) (*Workspace, error)
	ListWorkspaces(ctx context.Context) ([]Workspace, error)

	// Cluster methods.
	CreateCluster(ctx context.Context, p CreateClusterParams) (*Cluster, error)
	GetCluster(ctx context.Context, id string) (*Cluster, error)
	ListClusters(ctx context.Context) ([]Cluster, error)
	UpdateClusterPhase(ctx context.Context, id string, phase ClusterPhase, connectURL string) (*Cluster, error)
	DeleteCluster(ctx context.Context, id string) error

	// 4b lifecycle/config mutations.
	UpdateClusterConfig(ctx context.Context, id string, config json.RawMessage) (*Cluster, error)
	SetClusterDesiredState(ctx context.Context, id, desiredState string) (*Cluster, error)
	SetClusterPinned(ctx context.Context, id string, pinned bool) (*Cluster, error)
	TouchClusterActivity(ctx context.Context, id string) error

	// Notebook methods (4d).
	CreateNotebook(ctx context.Context, p CreateNotebookParams) (*Notebook, error)
	GetNotebook(ctx context.Context, id string) (*Notebook, error)
	ListNotebooks(ctx context.Context) ([]Notebook, error)
	UpdateNotebookContent(ctx context.Context, id string, content json.RawMessage) (*Notebook, error)
	AttachNotebookCluster(ctx context.Context, id, clusterID string) (*Notebook, error)
	TrashNotebook(ctx context.Context, id string) error
	CreateRevision(ctx context.Context, notebookID string, snapshot json.RawMessage, message, author string) (*NotebookRevision, error)
	ListRevisions(ctx context.Context, notebookID string) ([]NotebookRevision, error)
	GetRevision(ctx context.Context, revID string) (*NotebookRevision, error)
}
