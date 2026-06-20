// SPDX-License-Identifier: Apache-2.0

// Package store defines the persistence contract for the QuickSense API.
// It contains domain types, sentinel errors, and the Store interface.
// The concrete implementation is PgStore (pg.go); migrations live in migrate.go.
package store

import (
	"context"
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
	ID          string
	WorkspaceID string
	Name        string
	Namespace   string
	CRName      string
	Phase       ClusterPhase
	ConnectURL  string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

// CreateClusterParams carries the input required to create a new cluster record.
type CreateClusterParams struct {
	WorkspaceID string
	Name        string
	Namespace   string
	CRName      string
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
}
