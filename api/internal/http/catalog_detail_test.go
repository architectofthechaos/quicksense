// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/polaris"
)

func TestListNamespacesEndpoint(t *testing.T) {
	fp := &fakePolaris{namespaces: []polaris.Namespace{{Name: "demo"}, {Name: "analytics.sales"}}}
	mux := newTestMux(fp)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/catalogs/quicksense/namespaces", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var resp struct {
		Namespaces []polaris.Namespace `json:"namespaces"`
	}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if len(resp.Namespaces) != 2 || resp.Namespaces[0].Name != "demo" {
		t.Errorf("namespaces: %+v", resp.Namespaces)
	}
	if fp.listedCatalog != "quicksense" {
		t.Errorf("catalog passed to Polaris: %q", fp.listedCatalog)
	}
}

func TestTableDetailEndpoint(t *testing.T) {
	fp := &fakePolaris{tableMeta: &polaris.TableMetadata{
		Location:  "s3://warehouse/quicksense/demo/events",
		Format:    "iceberg/v2",
		Columns:   []polaris.Column{{Name: "id", Type: "long", Required: true}},
		Snapshots: []polaris.Snapshot{{SnapshotID: 1, Operation: "append"}},
	}}
	mux := newTestMux(fp)

	w := httptest.NewRecorder()
	mux.ServeHTTP(w, authReq(http.MethodGet, "/v1/catalogs/quicksense/namespaces/demo/tables/events", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
	var tm polaris.TableMetadata
	json.Unmarshal(w.Body.Bytes(), &tm)
	if len(tm.Columns) != 1 || tm.Columns[0].Name != "id" {
		t.Errorf("columns: %+v", tm.Columns)
	}
	if len(tm.Snapshots) != 1 || tm.Snapshots[0].Operation != "append" {
		t.Errorf("snapshots: %+v", tm.Snapshots)
	}
	if fp.listedNamespace != "demo" {
		t.Errorf("namespace passed to Polaris: %q", fp.listedNamespace)
	}
}
