// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestClusterEnforcement: a non-owner is scoped out and blocked server-side;
// an "attach" grant lets them view/attach but not manage (stop).
func TestClusterEnforcement(t *testing.T) {
	fs := newFakeStore()
	owner := newTestMuxWithClusters(&fakePolaris{}, fs, newFakeK8s()) // qsuser (admin) ⇒ owner

	w := httptest.NewRecorder()
	owner.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters", mustJSON(map[string]any{"name": "ent"})))
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var c map[string]any
	json.Unmarshal(w.Body.Bytes(), &c)
	id := c["id"].(string)

	// mallory: authenticated but not owner, not admin, no grant.
	mallory := muxAs(fs, fakeVerifierAs{username: "mallory", roles: []string{"polaris_admin"}})

	// GET → 403.
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/"+id, nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-owner GET: expected 403, got %d", w.Code)
	}

	// list is scoped — mallory sees none.
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters", nil))
	var lr struct {
		Clusters []map[string]any `json:"clusters"`
	}
	json.Unmarshal(w.Body.Bytes(), &lr)
	if len(lr.Clusters) != 0 {
		t.Errorf("scoped list: expected 0 for mallory, got %d", len(lr.Clusters))
	}

	// owner grants mallory "attach".
	w = httptest.NewRecorder()
	owner.ServeHTTP(w, authReq(http.MethodPut, "/v1/clusters/"+id+"/permissions",
		mustJSON(map[string]string{"principal_type": "user", "principal_id": "mallory", "level": "attach"})))
	if w.Code != http.StatusOK {
		t.Fatalf("grant attach: %d %s", w.Code, w.Body.String())
	}

	// now mallory can GET (attach).
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodGet, "/v1/clusters/"+id, nil))
	if w.Code != http.StatusOK {
		t.Errorf("after attach-grant GET: expected 200, got %d", w.Code)
	}

	// but attach ≠ manage ⇒ stop is forbidden.
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodPost, "/v1/clusters/"+id+"/stop", nil))
	if w.Code != http.StatusForbidden {
		t.Errorf("stop with only attach: expected 403, got %d", w.Code)
	}
}
