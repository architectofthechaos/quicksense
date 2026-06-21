// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

// TestNotebookEnforcement is the server-side permission matrix end-to-end:
// non-owner is denied, "Can Run" lets them run (but not edit), admin sees all.
func TestNotebookEnforcement(t *testing.T) {
	fs := newFakeStore()
	owner := newTestMuxWithClusters(&fakePolaris{}, fs, newFakeK8s()) // qsuser (owner)
	id := createNotebook(t, owner, `{"cells":[]}`)

	// mallory: authenticated (passes the realm gate) but not owner, no grant, not admin.
	mallory := muxAs(fs, fakeVerifierAs{username: "mallory", roles: []string{"polaris_admin"}})

	// 1) non-owner without a grant is denied (server-side).
	w := httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id, nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-owner GET: expected 403, got %d", w.Code)
	}

	// 2) owner grants mallory "run".
	w = httptest.NewRecorder()
	owner.ServeHTTP(w, authReq(http.MethodPut, "/v1/notebooks/"+id+"/permissions",
		mustJSON(map[string]string{"principal_type": "user", "principal_id": "mallory", "level": "run"})))
	if w.Code != http.StatusOK {
		t.Fatalf("grant run: %d %s", w.Code, w.Body.String())
	}

	// 3) run implies view ⇒ mallory can now read it.
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id, nil))
	if w.Code != http.StatusOK {
		t.Errorf("after run-grant GET: expected 200, got %d", w.Code)
	}

	// 4) mallory may run (passes authz → hits the 501 exec stub, NOT 403).
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks/"+id+"/run", mustJSON(map[string]any{"cell": 0})))
	if w.Code != http.StatusNotImplemented {
		t.Errorf("run with run-grant: expected 501, got %d", w.Code)
	}

	// 5) but run does NOT imply edit ⇒ save is forbidden.
	w = httptest.NewRecorder()
	mallory.ServeHTTP(w, authReq(http.MethodPut, "/v1/notebooks/"+id,
		mustJSON(map[string]any{"content": json.RawMessage(`{"cells":[]}`)})))
	if w.Code != http.StatusForbidden {
		t.Errorf("edit with only run-grant: expected 403, got %d", w.Code)
	}

	// 6) a quicksense_admin sees everything.
	admin := muxAs(fs, fakeVerifierAs{username: "root", roles: []string{"polaris_admin", "quicksense_admin"}})
	w = httptest.NewRecorder()
	admin.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id, nil))
	if w.Code != http.StatusOK {
		t.Errorf("admin GET: expected 200, got %d", w.Code)
	}
}
