// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/polaris"
)

// ---------------------------------------------------------------------------
// fakeVerifier — always succeeds with a fixed Principal.
// ---------------------------------------------------------------------------

type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, _ string) (*auth.Principal, error) {
	return &auth.Principal{Username: "qsuser", Roles: []string{"polaris_admin"}}, nil
}

// ---------------------------------------------------------------------------
// fakePolaris — records calls and returns canned responses.
// ---------------------------------------------------------------------------

type fakePolaris struct {
	catalogs         []polaris.Catalog
	createdCatalog   polaris.CreateCatalogParams
	tables           []polaris.Table
	listedCatalog    string
	listedNamespace  string
	createdTable     polaris.CreateTableParams
	createdTCatalog  string
	createdTNS       string
}

func (f *fakePolaris) ListCatalogs(_ context.Context) ([]polaris.Catalog, error) {
	return f.catalogs, nil
}

func (f *fakePolaris) CreateCatalog(_ context.Context, p polaris.CreateCatalogParams) (*polaris.Catalog, error) {
	f.createdCatalog = p
	return &polaris.Catalog{Name: p.Name, Type: "INTERNAL"}, nil
}

func (f *fakePolaris) ListTables(_ context.Context, catalog, namespace string) ([]polaris.Table, error) {
	f.listedCatalog = catalog
	f.listedNamespace = namespace
	return f.tables, nil
}

func (f *fakePolaris) CreateTable(_ context.Context, catalog, namespace string, p polaris.CreateTableParams) (*polaris.Table, error) {
	f.createdTCatalog = catalog
	f.createdTNS = namespace
	f.createdTable = p
	return &polaris.Table{Name: p.Name, Namespace: namespace}, nil
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

// newTestMux builds a router with fakeVerifier and the supplied fakePolaris.
func newTestMux(fp *fakePolaris) http.Handler {
	return NewRouter(RouterDeps{
		Verifier: fakeVerifier{},
		Polaris:  fp,
	})
}

// bearerHeader returns an Authorization header value accepted by fakeVerifier.
const bearerHeader = "Bearer test-token"

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
