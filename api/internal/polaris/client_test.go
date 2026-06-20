// SPDX-License-Identifier: Apache-2.0

package polaris_test

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/deepiq/quicksense/api/internal/polaris"
)

// newTestClient returns an HTTPClient pointed at srv using the stdlib http.Client.
func newTestClient(t *testing.T, srv *httptest.Server) *polaris.HTTPClient {
	t.Helper()
	c, err := polaris.NewHTTPClient(
		srv.URL,
		"POLARIS",
		"root",
		"s3cr3t",
		srv.Client(),
	)
	if err != nil {
		t.Fatalf("NewHTTPClient: %v", err)
	}
	return c
}

// --------------------------------------------------------------------------
// TestHTTPClient_TokenAndListCatalogs
// --------------------------------------------------------------------------

func TestHTTPClient_TokenAndListCatalogs(t *testing.T) {
	var tokenCalls atomic.Int32

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			tokenCalls.Add(1)

			// Assert HTTP Basic credentials
			u, p, ok := r.BasicAuth()
			if !ok {
				http.Error(w, "missing basic auth", http.StatusUnauthorized)
				return
			}
			if u != "root" || p != "s3cr3t" {
				http.Error(w, fmt.Sprintf("wrong creds: %s/%s", u, p), http.StatusUnauthorized)
				return
			}

			// Assert Polaris-Realm header
			if got := r.Header.Get("Polaris-Realm"); got != "POLARIS" {
				http.Error(w, "missing Polaris-Realm", http.StatusBadRequest)
				return
			}

			// Assert form body
			if err := r.ParseForm(); err != nil {
				http.Error(w, "bad form", http.StatusBadRequest)
				return
			}
			if r.FormValue("grant_type") != "client_credentials" {
				http.Error(w, "wrong grant_type", http.StatusBadRequest)
				return
			}
			if r.FormValue("scope") != "PRINCIPAL_ROLE:ALL" {
				http.Error(w, "wrong scope", http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok-abc",
				"expires_in":   3600,
				"token_type":   "bearer",
			})

		case "/api/management/v1/catalogs":
			// Assert Bearer token
			auth := r.Header.Get("Authorization")
			if auth != "Bearer tok-abc" {
				http.Error(w, "wrong bearer: "+auth, http.StatusUnauthorized)
				return
			}
			// Assert Polaris-Realm header
			if got := r.Header.Get("Polaris-Realm"); got != "POLARIS" {
				http.Error(w, "missing Polaris-Realm", http.StatusBadRequest)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"catalogs": []map[string]any{
					{"name": "quicksense", "type": "INTERNAL"},
				},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	// First call — fetches token, lists catalogs.
	catalogs, err := c.ListCatalogs(ctx)
	if err != nil {
		t.Fatalf("ListCatalogs (first): %v", err)
	}
	if len(catalogs) != 1 || catalogs[0].Name != "quicksense" || catalogs[0].Type != "INTERNAL" {
		t.Fatalf("unexpected catalogs: %+v", catalogs)
	}
	if tokenCalls.Load() != 1 {
		t.Fatalf("expected 1 token call after first ListCatalogs, got %d", tokenCalls.Load())
	}

	// Second call — token must be cached; NO second token fetch.
	_, err = c.ListCatalogs(ctx)
	if err != nil {
		t.Fatalf("ListCatalogs (second): %v", err)
	}
	if tokenCalls.Load() != 1 {
		t.Fatalf("expected token to be cached (still 1 call), got %d", tokenCalls.Load())
	}
}

// --------------------------------------------------------------------------
// TestHTTPClient_CreateCatalog_PayloadShape
// --------------------------------------------------------------------------

func TestHTTPClient_CreateCatalog_PayloadShape(t *testing.T) {
	var captured []byte

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok-xyz",
				"expires_in":   3600,
			})

		case "/api/management/v1/catalogs":
			if r.Method != http.MethodPost {
				http.Error(w, "want POST", http.StatusMethodNotAllowed)
				return
			}
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read body", http.StatusInternalServerError)
				return
			}
			captured = body

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"catalog": map[string]any{
					"name": "quicksense",
					"type": "INTERNAL",
				},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	_, err := c.CreateCatalog(ctx, polaris.CreateCatalogParams{
		Name:       "quicksense",
		Bucket:     "warehouse",
		S3Endpoint: "http://minio:9000",
		Region:     "us-east-1",
	})
	if err != nil {
		t.Fatalf("CreateCatalog: %v", err)
	}

	// Parse captured body.
	var payload struct {
		Catalog struct {
			Name     string `json:"name"`
			Type     string `json:"type"`
			ReadOnly bool   `json:"readOnly"`
			Properties struct {
				DefaultBaseLocation string `json:"default-base-location"`
			} `json:"properties"`
			StorageConfigInfo struct {
				StorageType      string   `json:"storageType"`
				AllowedLocations []string `json:"allowedLocations"`
				Endpoint         string   `json:"endpoint"`
				EndpointInternal string   `json:"endpointInternal"`
				PathStyleAccess  bool     `json:"pathStyleAccess"`
				Region           string   `json:"region"`
				StsUnavailable   bool     `json:"stsUnavailable"`
			} `json:"storageConfigInfo"`
		} `json:"catalog"`
	}
	if err := json.Unmarshal(captured, &payload); err != nil {
		t.Fatalf("parse captured body: %v\nbody: %s", err, captured)
	}

	cat := payload.Catalog
	sci := cat.StorageConfigInfo

	if cat.Type != "INTERNAL" {
		t.Errorf("catalog.type = %q, want INTERNAL", cat.Type)
	}
	if cat.ReadOnly {
		t.Errorf("catalog.readOnly should be false")
	}
	if sci.StorageType != "S3" {
		t.Errorf("storageConfigInfo.storageType = %q, want S3", sci.StorageType)
	}
	if !sci.StsUnavailable {
		t.Errorf("storageConfigInfo.stsUnavailable should be true")
	}
	if !sci.PathStyleAccess {
		t.Errorf("storageConfigInfo.pathStyleAccess should be true")
	}
	// allowedLocations must contain s3://warehouse/quicksense
	wantLoc := "s3://warehouse/quicksense"
	found := false
	for _, loc := range sci.AllowedLocations {
		if loc == wantLoc {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("allowedLocations = %v, want to contain %q", sci.AllowedLocations, wantLoc)
	}
	if cat.Properties.DefaultBaseLocation != wantLoc {
		t.Errorf("default-base-location = %q, want %q", cat.Properties.DefaultBaseLocation, wantLoc)
	}
}

// --------------------------------------------------------------------------
// TestHTTPClient_ListTables_IcebergPrefix
// --------------------------------------------------------------------------

func TestHTTPClient_ListTables_IcebergPrefix(t *testing.T) {
	var capturedPath string

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok-list",
				"expires_in":   3600,
			})

		case "/api/catalog/v1/quicksense/namespaces/demo/tables":
			capturedPath = r.URL.Path
			// Assert Bearer token
			auth := r.Header.Get("Authorization")
			if auth != "Bearer tok-list" {
				http.Error(w, "wrong bearer: "+auth, http.StatusUnauthorized)
				return
			}

			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"identifiers": []map[string]any{
					{
						"namespace": []string{"demo"},
						"name":      "events",
					},
				},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	tables, err := c.ListTables(ctx, "quicksense", "demo")
	if err != nil {
		t.Fatalf("ListTables: %v", err)
	}

	// Assert the correct Iceberg REST path was used.
	wantPath := "/api/catalog/v1/quicksense/namespaces/demo/tables"
	if capturedPath != wantPath {
		t.Errorf("path = %q, want %q", capturedPath, wantPath)
	}

	if len(tables) != 1 || tables[0].Name != "events" || tables[0].Namespace != "demo" {
		t.Fatalf("unexpected tables: %+v", tables)
	}
}

// --------------------------------------------------------------------------
// TestHTTPClient_APIError
// --------------------------------------------------------------------------

func TestHTTPClient_APIError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok-err",
				"expires_in":   3600,
			})

		case "/api/management/v1/catalogs":
			w.WriteHeader(http.StatusConflict)
			_, _ = w.Write([]byte(`{"error":"catalog already exists"}`))

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	// ListCatalogs against a 409 — should surface as *APIError.
	_, err := c.ListCatalogs(ctx)
	if err == nil {
		t.Fatal("expected error for non-2xx response")
	}
	var apiErr *polaris.APIError
	// Use errors.As via type assertion since the test is in polaris_test package.
	var ok bool
	apiErr, ok = unwrapAPIError(err)
	if !ok {
		t.Fatalf("expected *polaris.APIError, got %T: %v", err, err)
	}
	if apiErr.Status != http.StatusConflict {
		t.Errorf("APIError.Status = %d, want %d", apiErr.Status, http.StatusConflict)
	}
	if !strings.Contains(apiErr.Body, "catalog already exists") {
		t.Errorf("APIError.Body = %q, want to contain 'catalog already exists'", apiErr.Body)
	}
}

// --------------------------------------------------------------------------
// TestHTTPClient_CreateTable_PayloadShape
// --------------------------------------------------------------------------

func TestHTTPClient_CreateTable_PayloadShape(t *testing.T) {
	var capturedReq struct {
		method string
		path   string
		auth   string
		body   []byte
	}

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			w.Header().Set("Content-Type", "application/json")
			_ = json.NewEncoder(w).Encode(map[string]any{
				"access_token": "tok-create-table",
				"expires_in":   3600,
			})

		case "/api/catalog/v1/quicksense/namespaces/demo/tables":
			capturedReq.method = r.Method
			capturedReq.path = r.URL.Path
			capturedReq.auth = r.Header.Get("Authorization")
			body, err := io.ReadAll(r.Body)
			if err != nil {
				http.Error(w, "read body", http.StatusInternalServerError)
				return
			}
			capturedReq.body = body

			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"metadata-location": "s3://warehouse/quicksense/demo/events/metadata/v1.json",
				"metadata": map[string]any{
					"table-uuid": "550e8400-e29b-41d4-a716-446655440000",
				},
			})

		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	c := newTestClient(t, srv)
	ctx := context.Background()

	tbl, err := c.CreateTable(ctx, "quicksense", "demo", polaris.CreateTableParams{
		Name: "events",
	})
	if err != nil {
		t.Fatalf("CreateTable: %v", err)
	}

	// Assert METHOD and PATH.
	if capturedReq.method != http.MethodPost {
		t.Errorf("method = %q, want POST", capturedReq.method)
	}
	wantPath := "/api/catalog/v1/quicksense/namespaces/demo/tables"
	if capturedReq.path != wantPath {
		t.Errorf("path = %q, want %q", capturedReq.path, wantPath)
	}

	// Assert Authorization header.
	if capturedReq.auth != "Bearer tok-create-table" {
		t.Errorf("Authorization = %q, want \"Bearer tok-create-table\"", capturedReq.auth)
	}

	// Assert POST body has expected Iceberg REST create-table shape.
	var payload struct {
		Name   string `json:"name"`
		Schema struct {
			Type   string `json:"type"`
			Fields []struct {
				ID       int    `json:"id"`
				Name     string `json:"name"`
				Required bool   `json:"required"`
				Type     string `json:"type"`
			} `json:"fields"`
		} `json:"schema"`
	}
	if err := json.Unmarshal(capturedReq.body, &payload); err != nil {
		t.Fatalf("parse captured body: %v\nbody: %s", err, capturedReq.body)
	}
	if payload.Name != "events" {
		t.Errorf("body.name = %q, want \"events\"", payload.Name)
	}
	if payload.Schema.Type != "struct" {
		t.Errorf("body.schema.type = %q, want \"struct\"", payload.Schema.Type)
	}
	if len(payload.Schema.Fields) == 0 {
		t.Fatalf("body.schema.fields is empty, want at least one field")
	}
	f := payload.Schema.Fields[0]
	if f.Name != "id" {
		t.Errorf("schema.fields[0].name = %q, want \"id\"", f.Name)
	}
	if f.Type != "long" {
		t.Errorf("schema.fields[0].type = %q, want \"long\"", f.Type)
	}
	if !f.Required {
		t.Errorf("schema.fields[0].required should be true")
	}

	// Assert returned *Table has expected Name/Namespace.
	if tbl == nil {
		t.Fatal("CreateTable returned nil table")
	}
	if tbl.Name != "events" {
		t.Errorf("Table.Name = %q, want \"events\"", tbl.Name)
	}
	if tbl.Namespace != "demo" {
		t.Errorf("Table.Namespace = %q, want \"demo\"", tbl.Namespace)
	}
}

// unwrapAPIError extracts *polaris.APIError from err by walking the error chain.
func unwrapAPIError(err error) (*polaris.APIError, bool) {
	// Walk the chain manually since we are in the _test package.
	for err != nil {
		if ae, ok := err.(*polaris.APIError); ok {
			return ae, true
		}
		// Try Unwrap
		type unwrapper interface{ Unwrap() error }
		u, ok := err.(unwrapper)
		if !ok {
			break
		}
		err = u.Unwrap()
	}
	return nil, false
}
