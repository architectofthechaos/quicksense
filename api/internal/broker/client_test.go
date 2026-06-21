// SPDX-License-Identifier: Apache-2.0

package broker_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/deepiq/quicksense/api/internal/broker"
)

func TestRun(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/run" {
			http.Error(w, "not found", http.StatusNotFound)
			return
		}
		var req map[string]string
		_ = json.NewDecoder(r.Body).Decode(&req)
		if req["connect_url"] == "" || req["code"] == "" {
			http.Error(w, "missing fields", http.StatusBadRequest)
			return
		}
		_, _ = w.Write([]byte(`{"stdout":"+---+\n| id|\n+---+\n|  1|\n+---+\n"}`))
	}))
	defer srv.Close()

	c := broker.NewHTTPClient(srv.URL, srv.Client())
	res, err := c.Run(context.Background(), "sc://qs-demo-server:15002", "spark.sql('select 1 as id').show()")
	if err != nil {
		t.Fatalf("Run: %v", err)
	}
	if !strings.Contains(res.Stdout, "id") {
		t.Errorf("stdout: %q", res.Stdout)
	}
	if res.Error != "" {
		t.Errorf("unexpected error frame: %q", res.Error)
	}
}

func TestRunPropagatesBrokerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "boom", http.StatusBadGateway)
	}))
	defer srv.Close()

	c := broker.NewHTTPClient(srv.URL, srv.Client())
	if _, err := c.Run(context.Background(), "sc://x:15002", "1+1"); err == nil {
		t.Fatal("expected error on broker 502")
	}
}
