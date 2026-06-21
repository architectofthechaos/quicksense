// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/deepiq/quicksense/api/internal/store"
)

func cfgIdle(min int) json.RawMessage {
	b, _ := json.Marshal(map[string]int{"idle_minutes": min})
	return b
}

func TestIdleDueIDs(t *testing.T) {
	now := time.Now()
	clusters := []store.Cluster{
		{ID: "a", DesiredState: "Running", Config: cfgIdle(10), LastActivityAt: now.Add(-20 * time.Minute)},               // due
		{ID: "b", DesiredState: "Running", Config: cfgIdle(10), LastActivityAt: now.Add(-5 * time.Minute)},                // still within window
		{ID: "c", DesiredState: "Running", Config: cfgIdle(0), LastActivityAt: now.Add(-99 * time.Minute)},                // idle disabled
		{ID: "d", DesiredState: "Running", Pinned: true, Config: cfgIdle(10), LastActivityAt: now.Add(-99 * time.Minute)}, // pinned
		{ID: "e", DesiredState: "Stopped", Config: cfgIdle(10), LastActivityAt: now.Add(-99 * time.Minute)},               // already stopped
	}
	due := idleDueIDs(clusters, now)
	if len(due) != 1 || due[0] != "a" {
		t.Fatalf("expected due=[a], got %v", due)
	}
}

func TestIdleReconcilerStopsDue(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	fs.seed(&store.Cluster{
		ID: "x", CRName: "qs-x", DesiredState: "Running",
		Config: cfgIdle(1), LastActivityAt: time.Now().Add(-5 * time.Minute),
	})
	NewIdleReconciler(fs, fk).RunOnce(context.Background())

	if fk.deleteCount() != 1 {
		t.Errorf("expected 1 CR delete, got %d", fk.deleteCount())
	}
	c, _ := fs.GetCluster(context.Background(), "x")
	if c.DesiredState != "Stopped" {
		t.Errorf("desired_state: got %s, want Stopped", c.DesiredState)
	}
}
