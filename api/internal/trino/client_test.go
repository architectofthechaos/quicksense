// SPDX-License-Identifier: Apache-2.0

package trino_test

import (
	"context"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/trino"
)

func TestSampleFollowsNextURI(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("X-Trino-User") == "" {
			http.Error(w, "missing X-Trino-User", http.StatusBadRequest)
			return
		}
		switch r.URL.Path {
		case "/v1/statement":
			body, _ := io.ReadAll(r.Body)
			if !strings.Contains(string(body), "LIMIT 10") {
				http.Error(w, "bad sql: "+string(body), http.StatusBadRequest)
				return
			}
			_, _ = w.Write([]byte(`{"columns":[{"name":"id","type":"bigint"},{"name":"v","type":"varchar"}],"data":[[1,"a"]],"nextUri":"` + srv.URL + `/next"}`))
		case "/next":
			_, _ = w.Write([]byte(`{"data":[[2,"b"]]}`))
		default:
			http.Error(w, "unexpected "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := trino.NewHTTPClient(srv.URL, "quicksense", srv.Client())
	res, err := c.Sample(context.Background(), "iceberg", "demo", "events", 10)
	if err != nil {
		t.Fatalf("Sample: %v", err)
	}
	if len(res.Columns) != 2 || res.Columns[0] != "id" || res.Columns[1] != "v" {
		t.Errorf("columns: %+v", res.Columns)
	}
	if len(res.Rows) != 2 {
		t.Fatalf("expected 2 rows (paged), got %d: %+v", len(res.Rows), res.Rows)
	}
	if res.Rows[1][1] != "b" {
		t.Errorf("second-page row: %+v", res.Rows[1])
	}
}

func TestSampleAttributesCallerUser(t *testing.T) {
	var gotUser string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotUser = r.Header.Get("X-Trino-User")
		if r.URL.Path == "/v1/statement" {
			_, _ = w.Write([]byte(`{"columns":[{"name":"id","type":"bigint"}],"data":[[1]]}`))
			return
		}
		http.Error(w, "x", http.StatusNotFound)
	}))
	defer srv.Close()

	c := trino.NewHTTPClient(srv.URL, "service-user", srv.Client())
	ctx := auth.ContextWithPrincipal(context.Background(), &auth.Principal{Username: "alice"})
	if _, err := c.Sample(ctx, "iceberg", "demo", "events", 5); err != nil {
		t.Fatalf("Sample: %v", err)
	}
	if gotUser != "alice" {
		t.Errorf("X-Trino-User: got %q, want alice (caller, not the service user)", gotUser)
	}
}
