// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"context"
	"encoding/json"
	"log"
	"time"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"

	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/store"
)

// IdleReconciler stops Running, unpinned clusters whose idle window has elapsed.
// It is the server-side enforcement of "Auto-terminate after N minutes idle".
type IdleReconciler struct {
	store store.Store
	k8s   k8s.SparkConnectClient
}

// NewIdleReconciler builds an IdleReconciler.
func NewIdleReconciler(st store.Store, kc k8s.SparkConnectClient) *IdleReconciler {
	return &IdleReconciler{store: st, k8s: kc}
}

// idleDueIDs returns the IDs of clusters eligible for idle auto-terminate at
// `now`: Running, not pinned, with a positive idle_minutes (from persisted
// config) whose last activity is older than that window. Pure for testability.
func idleDueIDs(clusters []store.Cluster, now time.Time) []string {
	var due []string
	for _, c := range clusters {
		if c.Pinned || c.DesiredState != "Running" {
			continue
		}
		var cfg struct {
			IdleMinutes int `json:"idle_minutes"`
		}
		_ = json.Unmarshal(c.Config, &cfg)
		if cfg.IdleMinutes <= 0 {
			continue // idle auto-terminate disabled for this cluster
		}
		if now.Sub(c.LastActivityAt) > time.Duration(cfg.IdleMinutes)*time.Minute {
			due = append(due, c.ID)
		}
	}
	return due
}

// RunOnce stops every currently-due cluster (delete CR, keep row, mark Stopped).
func (rc *IdleReconciler) RunOnce(ctx context.Context) {
	clusters, err := rc.store.ListClusters(ctx)
	if err != nil {
		log.Printf("idle-reconcile: list clusters: %v", err)
		return
	}
	for _, id := range idleDueIDs(clusters, time.Now()) {
		c, err := rc.store.GetCluster(ctx, id)
		if err != nil {
			continue
		}
		if err := rc.k8s.Delete(ctx, c.CRName); err != nil && !k8serrors.IsNotFound(err) {
			log.Printf("idle-reconcile: stop %s: %v", c.CRName, err)
			continue
		}
		if _, err := rc.store.SetClusterDesiredState(ctx, id, "Stopped"); err != nil {
			log.Printf("idle-reconcile: mark stopped %s: %v", id, err)
			continue
		}
		log.Printf("idle-reconcile: auto-stopped idle cluster %s (%s)", id, c.CRName)
	}
}

// Start runs RunOnce on an interval until ctx is cancelled.
func (rc *IdleReconciler) Start(ctx context.Context, interval time.Duration) {
	t := time.NewTicker(interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			rc.RunOnce(ctx)
		}
	}
}
