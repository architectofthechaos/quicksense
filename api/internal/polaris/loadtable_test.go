// SPDX-License-Identifier: Apache-2.0

package polaris_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/polaris"
)

// tokenAnd serves the OAuth token endpoint and delegates everything else to h.
func tokenAnd(t *testing.T, h http.HandlerFunc) *polaris.HTTPClient {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/catalog/v1/oauth/tokens" {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"tok","expires_in":3600}`))
			return
		}
		h(w, r)
	}))
	t.Cleanup(srv.Close)
	c, err := polaris.NewHTTPClient(srv.URL, "POLARIS", "root", "s3cr3t", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient: %v", err)
	}
	return c
}

func TestListNamespaces(t *testing.T) {
	c := tokenAnd(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/catalog/v1/quicksense/namespaces" {
			_, _ = w.Write([]byte(`{"namespaces":[["demo"],["analytics","sales"]]}`))
			return
		}
		http.Error(w, "unexpected "+r.URL.Path, http.StatusNotFound)
	})
	ns, err := c.ListNamespaces(context.Background(), "quicksense")
	if err != nil {
		t.Fatalf("ListNamespaces: %v", err)
	}
	if len(ns) != 2 || ns[0].Name != "demo" || ns[1].Name != "analytics.sales" {
		t.Fatalf("namespaces: %+v", ns)
	}
}

func TestLoadTable(t *testing.T) {
	const resp = `{"metadata":{
		"location":"s3://warehouse/quicksense/demo/events",
		"format-version":2,
		"current-schema-id":0,
		"current-snapshot-id":123,
		"schemas":[{"schema-id":0,"fields":[
			{"name":"id","required":true,"type":"long","doc":"pk"},
			{"name":"props","required":false,"type":{"type":"map","key":"string","value":"string"}}
		]}],
		"partition-specs":[{"fields":[{"name":"day"}]}],
		"properties":{"owner":"qs"},
		"snapshots":[{"snapshot-id":123,"timestamp-ms":1700000000000,"summary":{"operation":"append"}}]
	}}`
	c := tokenAnd(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/api/catalog/v1/quicksense/namespaces/demo/tables/events" {
			_, _ = w.Write([]byte(resp))
			return
		}
		http.Error(w, "unexpected "+r.URL.Path, http.StatusNotFound)
	})
	tm, err := c.LoadTable(context.Background(), "quicksense", "demo", "events")
	if err != nil {
		t.Fatalf("LoadTable: %v", err)
	}
	if tm.Location != "s3://warehouse/quicksense/demo/events" {
		t.Errorf("location: %q", tm.Location)
	}
	if len(tm.Columns) != 2 || tm.Columns[0].Name != "id" || tm.Columns[0].Type != "long" || !tm.Columns[0].Required {
		t.Errorf("columns: %+v", tm.Columns)
	}
	if tm.Columns[1].Type != "map" {
		t.Errorf("nested type should resolve to 'map': %q", tm.Columns[1].Type)
	}
	if len(tm.Snapshots) != 1 || tm.Snapshots[0].Operation != "append" {
		t.Errorf("snapshots: %+v", tm.Snapshots)
	}
	if len(tm.PartitionFields) != 1 || tm.PartitionFields[0] != "day" {
		t.Errorf("partition fields: %+v", tm.PartitionFields)
	}
	if tm.Properties["owner"] != "qs" {
		t.Errorf("properties: %+v", tm.Properties)
	}
}

// TestUsesServiceTokenNotCallerToken locks in the 4e decision: Polaris always
// authenticates with its own service credential, even when a caller token is
// present in context. Forwarding the caller's Keycloak token to Polaris would
// require a single shared issuer (or RFC 8693 token-exchange); the dev split
// issuer (API verifies localhost:8082, Polaris's OIDC expects keycloak:8082)
// makes a forwarded token fail Polaris validation. Per-user Polaris attribution
// is deferred to token-exchange. (Trino per-user via X-Trino-User works today.)
func TestUsesServiceTokenNotCallerToken(t *testing.T) {
	var gotAuth string
	tokenCalls := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/catalog/v1/oauth/tokens":
			tokenCalls++
			_, _ = w.Write([]byte(`{"access_token":"service","expires_in":3600}`))
		case "/api/management/v1/catalogs":
			gotAuth = r.Header.Get("Authorization")
			_, _ = w.Write([]byte(`{"catalogs":[]}`))
		default:
			http.Error(w, "unexpected "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c, err := polaris.NewHTTPClient(srv.URL, "POLARIS", "root", "s3cr3t", srv.Client())
	if err != nil {
		t.Fatalf("NewHTTPClient: %v", err)
	}
	// A caller token in context must NOT leak to Polaris — the service token is used.
	ctx := auth.ContextWithToken(context.Background(), "caller-jwt")
	if _, err := c.ListCatalogs(ctx); err != nil {
		t.Fatalf("ListCatalogs: %v", err)
	}
	if gotAuth != "Bearer service" {
		t.Errorf("Authorization: got %q, want Bearer service (caller token must not leak)", gotAuth)
	}
	if tokenCalls == 0 {
		t.Errorf("expected the service token to be fetched; got %d token calls", tokenCalls)
	}
}
