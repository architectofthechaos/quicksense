// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/k8s"
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
