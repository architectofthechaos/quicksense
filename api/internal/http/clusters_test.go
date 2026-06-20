// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	k8serrors "k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/store"
)

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

func clusterMux(fs *fakeStore, fk k8s.SparkConnectClient) http.Handler {
	return newTestMuxWithClusters(&fakePolaris{}, fs, fk)
}

func authReq(method, path string, body []byte) *http.Request {
	var req *http.Request
	if body != nil {
		req = httptest.NewRequest(method, path, bytes.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	} else {
		req = httptest.NewRequest(method, path, nil)
	}
	req.Header.Set("Authorization", bearerHeader)
	return req
}

// ---------------------------------------------------------------------------
// B12: POST /v1/clusters
// ---------------------------------------------------------------------------

func TestPostCluster_Created(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	body, _ := json.Marshal(map[string]string{"name": "demo"})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters", body))

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	id, ok := resp["id"].(string)
	if !ok || id == "" {
		t.Fatalf("expected non-empty id in response, got: %v", resp)
	}

	// fakeK8s.Create should have been called exactly once.
	if n := fk.createCount(); n != 1 {
		t.Fatalf("expected 1 k8s.Create call, got %d", n)
	}

	// fakeStore should have exactly one cluster row with a CRName.
	if n := fs.count(); n != 1 {
		t.Fatalf("expected 1 store row, got %d", n)
	}

	fk.mu.Lock()
	spec := fk.createCalls[0]
	fk.mu.Unlock()
	if spec.Image == "" {
		t.Fatal("expected non-empty Image in ClusterSpec")
	}
}

func TestPostCluster_BadJSON(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters", []byte("{bad json")))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPostCluster_EmptyName(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	body, _ := json.Marshal(map[string]string{"name": ""})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters", body))
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestPostCluster_K8sError_Returns502(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	fk.createErr = fmt.Errorf("k8s unavailable")
	mux := clusterMux(fs, fk)

	body, _ := json.Marshal(map[string]string{"name": "demo"})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters", body))
	if w.Code != http.StatusBadGateway {
		t.Fatalf("expected 502, got %d; body: %s", w.Code, w.Body.String())
	}
	if n := fs.count(); n != 0 {
		t.Fatalf("expected 0 store rows after k8s error, got %d", n)
	}
}

func TestPostCluster_NoAuth(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	body, _ := json.Marshal(map[string]string{"name": "demo"})
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/v1/clusters", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// B13: GET /v1/clusters/{id}
// ---------------------------------------------------------------------------

func TestGetCluster_MergesLivePhase(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	fk.getStatus = k8s.ClusterStatus{Phase: "RunningReady", Ready: true}

	seeded := &store.Cluster{
		ID:        "test-id-1",
		Name:      "demo",
		Namespace: "quicksense",
		CRName:    "qs-demo-abc123",
		Phase:     store.ClusterPhasePending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	}
	fs.seed(seeded)

	mux := clusterMux(fs, fk)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/test-id-1", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if resp["phase"] != "RunningReady" {
		t.Fatalf("expected phase 'RunningReady', got %v", resp["phase"])
	}
	if resp["id"] != "test-id-1" {
		t.Fatalf("expected id 'test-id-1', got %v", resp["id"])
	}
}

func TestGetCluster_NotFound(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/nonexistent", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

// ---------------------------------------------------------------------------
// B13: GET /v1/clusters (list)
// ---------------------------------------------------------------------------

func TestListClusters_MergesLiveStatus(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	fk.getStatus = k8s.ClusterStatus{Phase: "Running", Ready: false}

	fs.seed(&store.Cluster{
		ID:        "cl-1",
		Name:      "alpha",
		Namespace: "quicksense",
		CRName:    "qs-alpha-001",
		Phase:     store.ClusterPhasePending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	mux := clusterMux(fs, fk)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	clusters, ok := resp["clusters"].([]any)
	if !ok {
		t.Fatalf("expected clusters array, got %T: %v", resp["clusters"], resp)
	}
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	cl := clusters[0].(map[string]any)
	if cl["phase"] != "Running" {
		t.Fatalf("expected merged phase 'Running', got %v", cl["phase"])
	}
}

func TestListClusters_ToleratesK8sNotFound(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()

	crName := "qs-beta-missing"
	fk.notFoundNames[crName] = true

	fs.seed(&store.Cluster{
		ID:        "cl-2",
		Name:      "beta",
		Namespace: "quicksense",
		CRName:    crName,
		Phase:     store.ClusterPhasePending,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	mux := clusterMux(fs, fk)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters", nil))

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 even with missing CR, got %d; body: %s", w.Code, w.Body.String())
	}

	var resp map[string]any
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode: %v", err)
	}
	clusters := resp["clusters"].([]any)
	if len(clusters) != 1 {
		t.Fatalf("expected 1 cluster, got %d", len(clusters))
	}
	cl := clusters[0].(map[string]any)
	if cl["phase"] != "Unknown" {
		t.Fatalf("expected phase 'Unknown' for missing CR, got %v", cl["phase"])
	}
}

// ---------------------------------------------------------------------------
// B13: DELETE /v1/clusters/{id}
// ---------------------------------------------------------------------------

func TestDeleteCluster_Success(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()

	fs.seed(&store.Cluster{
		ID:        "del-id-1",
		Name:      "to-delete",
		Namespace: "quicksense",
		CRName:    "qs-to-delete-xyz",
		Phase:     store.ClusterPhaseRunning,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	mux := clusterMux(fs, fk)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodDelete, "/v1/clusters/del-id-1", nil))

	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d; body: %s", w.Code, w.Body.String())
	}

	// fakeK8s.Delete should have been called once.
	if n := fk.deleteCount(); n != 1 {
		t.Fatalf("expected 1 k8s.Delete call, got %d", n)
	}

	// The cluster row should be gone from the store.
	if n := fs.count(); n != 0 {
		t.Fatalf("expected 0 store rows after delete, got %d", n)
	}
}

func TestDeleteCluster_NotFound(t *testing.T) {
	fs := newFakeStore()
	fk := newFakeK8s()
	mux := clusterMux(fs, fk)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodDelete, "/v1/clusters/ghost-id", nil))
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func TestDeleteCluster_IdempotentK8sNotFound(t *testing.T) {
	fs := newFakeStore()
	fkNotFound := &fakeK8sDeleteNotFound{}

	fs.seed(&store.Cluster{
		ID:        "del-id-2",
		Name:      "already-gone",
		Namespace: "quicksense",
		CRName:    "qs-already-gone-abc",
		Phase:     store.ClusterPhaseRunning,
		CreatedAt: time.Now(),
		UpdatedAt: time.Now(),
	})

	mux := newTestMuxWithClusters(&fakePolaris{}, fs, fkNotFound)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodDelete, "/v1/clusters/del-id-2", nil))

	// Should still succeed — k8s NotFound on delete is tolerated.
	if w.Code != http.StatusNoContent {
		t.Fatalf("expected 204 when CR already gone, got %d; body: %s", w.Code, w.Body.String())
	}
	// DB row should be deleted.
	if n := fs.count(); n != 0 {
		t.Fatalf("expected 0 store rows, got %d", n)
	}
}

// fakeK8sDeleteNotFound simulates a SparkConnectClient where Delete returns k8s NotFound.
type fakeK8sDeleteNotFound struct {
	deleteCalls []string
}

func (f *fakeK8sDeleteNotFound) Create(_ context.Context, s k8s.ClusterSpec) (string, error) {
	return s.Name, nil
}

func (f *fakeK8sDeleteNotFound) Get(_ context.Context, name string) (k8s.ClusterStatus, error) {
	return k8s.ClusterStatus{Name: name, Phase: "Running"}, nil
}

func (f *fakeK8sDeleteNotFound) Delete(_ context.Context, name string) error {
	f.deleteCalls = append(f.deleteCalls, name)
	return k8serrors.NewNotFound(schema.GroupResource{
		Group:    "sparkoperator.k8s.io",
		Resource: "sparkconnects",
	}, name)
}
