// SPDX-License-Identifier: Apache-2.0

// Package httpapi is the HTTP wiring layer for the QuickSense control-plane API.
// It exposes NewRouter and RouterDeps — the stable seam that every later Phase B
// task extends.
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

// RouterDeps is the dependency-injection bundle passed to NewRouter.
// Fields are added by later tasks; the zero value (RouterDeps{}) is valid for
// the /healthz-only skeleton.
//
// Fields to be added:
//   - Verifier auth.TokenVerifier    — B4: Keycloak JWT verifier
//   - Polaris  polaris.Client        — B7: Polaris REST proxy
//   - Store    store.Store           — B5/B6: Postgres store
//   - K8s      k8s.SparkConnectClient — B10: Spark compute client
//   - Namespace   string             — SparkConnect namespace
//   - DefaultExec int32              — default executor count
type RouterDeps struct{}

// NewRouter builds and returns a configured chi.Mux.
// It mounts:
//   - GET /healthz (unauthenticated liveness probe)
//
// Later tasks add:
//   - RequireAuth middleware on the /v1 group (B4)
//   - Catalog/table routes under /v1 (B8)
//   - Cluster routes under /v1 (B12/B13)
func NewRouter(deps RouterDeps) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", healthz)

	return r
}

// healthz is the liveness handler; no auth required.
func healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK\n"))
}
