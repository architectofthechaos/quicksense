// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestPermissionsGrantListRevoke(t *testing.T) {
	fs := newFakeStore()
	mux := newTestMuxWithClusters(&fakePolaris{}, fs, newFakeK8s())

	// grant cluster:attach to user bob
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPut, "/v1/clusters/c1/permissions",
		mustJSON(map[string]string{"principal_type": "user", "principal_id": "bob", "level": "attach"})))
	if w.Code != http.StatusOK {
		t.Fatalf("grant: %d %s", w.Code, w.Body.String())
	}

	// list → 1
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/c1/permissions", nil))
	var lr struct {
		Permissions []map[string]any `json:"permissions"`
	}
	json.Unmarshal(w.Body.Bytes(), &lr)
	if len(lr.Permissions) != 1 || lr.Permissions[0]["level"] != "attach" || lr.Permissions[0]["principal_id"] != "bob" {
		t.Fatalf("list: %+v", lr.Permissions)
	}

	// invalid level → 400
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPut, "/v1/clusters/c1/permissions",
		mustJSON(map[string]string{"principal_type": "user", "principal_id": "bob", "level": "bogus"})))
	if w.Code != http.StatusBadRequest {
		t.Errorf("invalid level: expected 400, got %d", w.Code)
	}

	// revoke
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodDelete, "/v1/clusters/c1/permissions?principal_type=user&principal_id=bob", nil))
	if w.Code != http.StatusNoContent {
		t.Fatalf("revoke: %d %s", w.Code, w.Body.String())
	}

	// list → 0
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/c1/permissions", nil))
	json.Unmarshal(w.Body.Bytes(), &lr)
	if len(lr.Permissions) != 0 {
		t.Errorf("after revoke: expected 0, got %+v", lr.Permissions)
	}
}

func TestNotebookPermissionLevelValidation(t *testing.T) {
	fs := newFakeStore()
	mux := newTestMuxWithClusters(&fakePolaris{}, fs, newFakeK8s())

	// "run" is valid for notebooks but not clusters
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPut, "/v1/notebooks/nb1/permissions",
		mustJSON(map[string]string{"principal_type": "group", "principal_id": "data", "level": "run"})))
	if w.Code != http.StatusOK {
		t.Fatalf("notebook run grant: %d %s", w.Code, w.Body.String())
	}

	// "attach" is a cluster level, invalid for notebooks
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPut, "/v1/notebooks/nb1/permissions",
		mustJSON(map[string]string{"principal_type": "group", "principal_id": "data", "level": "attach"})))
	if w.Code != http.StatusBadRequest {
		t.Errorf("notebook attach grant: expected 400, got %d", w.Code)
	}
}
