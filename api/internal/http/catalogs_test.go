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
// Catalog tests
// ---------------------------------------------------------------------------

func TestListCatalogs_NoAuth(t *testing.T) {
	mux := newTestMux(&fakePolaris{})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/catalogs", nil)
	mux.ServeHTTP(w, r)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestListCatalogs_WithAuth(t *testing.T) {
	fp := &fakePolaris{
		catalogs: []polaris.Catalog{
			{Name: "quicksense", Type: "INTERNAL"},
		},
	}
	mux := newTestMux(fp)
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodGet, "/v1/catalogs", nil)
	r.Header.Set("Authorization", bearerHeader)
	mux.ServeHTTP(w, r)

	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d; body: %s", w.Code, w.Body.String())
	}

	var resp struct {
		Catalogs []polaris.Catalog `json:"catalogs"`
	}
	if err := json.NewDecoder(w.Body).Decode(&resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(resp.Catalogs) != 1 || resp.Catalogs[0].Name != "quicksense" {
		t.Fatalf("unexpected catalogs: %+v", resp.Catalogs)
	}
}

func TestCreateCatalog(t *testing.T) {
	fp := &fakePolaris{}
	mux := newTestMux(fp)

	body, _ := json.Marshal(polaris.CreateCatalogParams{
		Name:       "demo-cat",
		Bucket:     "warehouse",
		S3Endpoint: "http://minio:9000",
		Region:     "us-east-1",
	})
	w := httptest.NewRecorder()
	r := httptest.NewRequest(http.MethodPost, "/v1/catalogs", bytes.NewReader(body))
	r.Header.Set("Authorization", bearerHeader)
	r.Header.Set("Content-Type", "application/json")
	mux.ServeHTTP(w, r)

	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d; body: %s", w.Code, w.Body.String())
	}
	if fp.createdCatalog.Name != "demo-cat" {
		t.Fatalf("expected forwarded name 'demo-cat', got %q", fp.createdCatalog.Name)
	}

	var cat polaris.Catalog
	if err := json.NewDecoder(w.Body).Decode(&cat); err != nil {
		t.Fatalf("decode catalog: %v", err)
	}
	if cat.Name != "demo-cat" {
		t.Fatalf("expected catalog name 'demo-cat', got %q", cat.Name)
	}
}
