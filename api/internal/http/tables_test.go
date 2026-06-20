// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/polaris"
)

// ---------------------------------------------------------------------------
// Table tests
// ---------------------------------------------------------------------------

func TestListTables_PathParams(t *testing.T) {
	fp := &fakePolaris{
		tables: []polaris.Table{
			{Name: "events", Namespace: "demo"},
		},
	}
	mux := newTestMux(fp)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/catalogs/quicksense/namespaces/demo/tables", nil)
	r.Header.Set("Authorization", bearerHeader)
	mux.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}

	// Assert path params flowed through to fakePolaris.
	if fp.listedCatalog != "quicksense" {
		t.Fatalf("expected catalog='quicksense', got %q", fp.listedCatalog)
	}
	if fp.listedNamespace != "demo" {
		t.Fatalf("expected namespace='demo', got %q", fp.listedNamespace)
	}

	var resp struct {
		Tables []polaris.Table `json:"tables"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Tables) != 1 || resp.Tables[0].Name != "events" {
		t.Fatalf("unexpected tables: %+v", resp.Tables)
	}
}

func TestListTables_NoAuth(t *testing.T) {
	mux := newTestMux(&fakePolaris{})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/catalogs/quicksense/namespaces/demo/tables", nil)
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestCreateTable(t *testing.T) {
	fp := &fakePolaris{}
	mux := newTestMux(fp)

	body, _ := json.Marshal(polaris.CreateTableParams{
		Name: "events",
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/catalogs/quicksense/namespaces/demo/tables", bytes.NewReader(body))
	r.Header.Set("Authorization", bearerHeader)
	r.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", w.Code, w.Body.String())
	}
	if fp.createdTCatalog != "quicksense" {
		t.Fatalf("expected catalog='quicksense', got %q", fp.createdTCatalog)
	}
	if fp.createdTNS != "demo" {
		t.Fatalf("expected namespace='demo', got %q", fp.createdTNS)
	}
	if fp.createdTable.Name != "events" {
		t.Fatalf("expected table name='events', got %q", fp.createdTable.Name)
	}
}
