// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func notebookMux(fs *fakeStore) http.Handler {
	return newTestMuxWithClusters(&fakePolaris{}, fs, newFakeK8s())
}

func mustJSON(v any) []byte {
	b, _ := json.Marshal(v)
	return b
}

func createNotebook(t *testing.T, mux http.Handler, content string) string {
	t.Helper()
	body := mustJSON(map[string]any{"name": "nb", "path": "/nb", "content": json.RawMessage(content)})
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks", body))
	if w.Code != http.StatusCreated {
		t.Fatalf("create notebook: %d %s", w.Code, w.Body.String())
	}
	var nb map[string]any
	json.Unmarshal(w.Body.Bytes(), &nb)
	return nb["id"].(string)
}

func TestNotebookSaveUpdateRestore(t *testing.T) {
	fs := newFakeStore()
	mux := notebookMux(fs)
	id := createNotebook(t, mux, `{"cells":[{"type":"code","source":"print(1)"}]}`)

	// snapshot current content as revision v1
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks/"+id+"/revisions", mustJSON(map[string]string{"message": "v1"})))
	if w.Code != http.StatusCreated {
		t.Fatalf("save revision: %d %s", w.Code, w.Body.String())
	}

	// edit content to print(2)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPut, "/v1/notebooks/"+id, mustJSON(map[string]any{"content": json.RawMessage(`{"cells":[{"type":"code","source":"print(2)"}]}`)})))
	if w.Code != http.StatusOK {
		t.Fatalf("update: %d %s", w.Code, w.Body.String())
	}

	// list revisions → 1
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id+"/revisions", nil))
	var lr struct {
		Revisions []map[string]any `json:"revisions"`
	}
	json.Unmarshal(w.Body.Bytes(), &lr)
	if len(lr.Revisions) != 1 {
		t.Fatalf("expected 1 revision, got %+v", lr.Revisions)
	}
	revID := lr.Revisions[0]["id"].(string)

	// restore → content reverts to print(1)
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks/"+id+"/revisions/"+revID+"/restore", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("restore: %d %s", w.Code, w.Body.String())
	}
	var restored map[string]any
	json.Unmarshal(w.Body.Bytes(), &restored)
	if cb := mustJSON(restored["content"]); !bytes.Contains(cb, []byte("print(1)")) {
		t.Errorf("restore did not revert content: %s", cb)
	}
}

func TestNotebookCreateSetsOwner(t *testing.T) {
	fs := newFakeStore()
	mux := notebookMux(fs)
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks", mustJSON(map[string]any{"name": "owned", "path": "/owned"})))
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	var nb map[string]any
	json.Unmarshal(w.Body.Bytes(), &nb)
	if nb["owner"] != "qsuser" {
		t.Errorf("owner: got %v, want qsuser (the authenticated principal ⇒ implicit manage)", nb["owner"])
	}
}

func TestNotebookAttachCluster(t *testing.T) {
	fs := newFakeStore()
	mux := notebookMux(fs)
	id := createNotebook(t, mux, `{"cells":[]}`)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks/"+id+"/attach", mustJSON(map[string]string{"cluster_id": "cl-1"})))
	if w.Code != http.StatusOK {
		t.Fatalf("attach: %d %s", w.Code, w.Body.String())
	}
	var nb map[string]any
	json.Unmarshal(w.Body.Bytes(), &nb)
	if nb["attached_cluster_id"] != "cl-1" {
		t.Errorf("attached_cluster_id: %v", nb["attached_cluster_id"])
	}
}

func TestNotebookRunNotImplemented(t *testing.T) {
	fs := newFakeStore()
	mux := notebookMux(fs)
	id := createNotebook(t, mux, `{"cells":[]}`)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodPost, "/v1/notebooks/"+id+"/run", mustJSON(map[string]any{"cell": 0})))
	if w.Code != http.StatusNotImplemented {
		t.Fatalf("run (broker not wired): expected 501, got %d %s", w.Code, w.Body.String())
	}
}

func TestNotebookExport(t *testing.T) {
	fs := newFakeStore()
	mux := notebookMux(fs)
	id := createNotebook(t, mux, `{"cells":[{"type":"markdown","source":"# Title"},{"type":"code","source":"print(1)"}]}`)

	// .py
	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id+"/export?format=py", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("py export: %d", w.Code)
	}
	if !bytes.Contains(w.Body.Bytes(), []byte("print(1)")) || !bytes.Contains(w.Body.Bytes(), []byte("# %%")) {
		t.Errorf("py export body: %s", w.Body.String())
	}

	// .ipynb
	w = httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/notebooks/"+id+"/export?format=ipynb", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("ipynb export: %d", w.Code)
	}
	var doc map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &doc); err != nil {
		t.Fatalf("ipynb not valid JSON: %v", err)
	}
	if doc["nbformat"] != float64(4) {
		t.Errorf("nbformat: %v", doc["nbformat"])
	}
}
