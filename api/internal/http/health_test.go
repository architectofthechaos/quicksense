// SPDX-License-Identifier: Apache-2.0

package httpapi_test

import (
	"net/http"
	"net/http/httptest"
	"testing"

	httpapi "github.com/deepiq/quicksense/api/internal/http"
)

func TestHealthz(t *testing.T) {
	srv := httptest.NewServer(httpapi.NewRouter(httpapi.RouterDeps{}))
	defer srv.Close()

	resp, err := http.Get(srv.URL + "/healthz")
	if err != nil {
		t.Fatalf("GET /healthz: %v", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		t.Errorf("status = %d; want 200", resp.StatusCode)
	}
	want := "text/plain; charset=utf-8"
	if ct := resp.Header.Get("Content-Type"); ct != want {
		t.Errorf("Content-Type = %q; want %q", ct, want)
	}
}
