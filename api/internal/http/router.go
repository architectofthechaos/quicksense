// SPDX-License-Identifier: Apache-2.0

// Package httpapi is the HTTP wiring layer for the QuickSense control-plane API.
// It exposes NewRouter and RouterDeps — the stable seam that every later Phase B
// task extends.
package httpapi

import (
	"net/http"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/polaris"
	"github.com/deepiq/quicksense/api/internal/store"
)

// RouterDeps is the dependency-injection bundle passed to NewRouter.
type RouterDeps struct {
	Verifier auth.TokenVerifier     // B4: Keycloak JWT verifier
	Polaris  polaris.Client         // B7: Polaris REST proxy
	Store    store.Store            // B9: Postgres store
	K8s      k8s.SparkConnectClient // B12: Spark compute client
	Namespace      string            // SparkConnect target namespace
	DefaultExec    int32             // default executor count per cluster
	SparkImage     string            // Spark container image
	ServiceAccount string            // Kubernetes ServiceAccount for driver pods
	SparkConf      map[string]string // Iceberg/catalog SparkConf entries
}

// NewRouter builds and returns a configured chi.Mux.
// It mounts:
//   - GET /healthz (unauthenticated liveness probe)
//   - /v1 group (RequireAuth + catalog/table routes)
func NewRouter(deps RouterDeps) *chi.Mux {
	r := chi.NewRouter()
	r.Use(middleware.RequestID)
	r.Use(middleware.RealIP)
	r.Use(middleware.Recoverer)

	r.Get("/healthz", healthz)

	r.Route("/v1", func(r chi.Router) {
		r.Use(auth.RequireAuth(deps.Verifier))
		ch := &catalogHandler{polaris: deps.Polaris}
		r.Get("/catalogs", ch.list)
		r.Post("/catalogs", ch.create)
		r.Get("/catalogs/{catalog}/namespaces", ch.listNamespaces)
		th := &tableHandler{polaris: deps.Polaris}
		r.Get("/catalogs/{catalog}/namespaces/{namespace}/tables", th.list)
		r.Post("/catalogs/{catalog}/namespaces/{namespace}/tables", th.create)
		r.Get("/catalogs/{catalog}/namespaces/{namespace}/tables/{table}", th.get)
		clh := &clusterHandler{
			store:          deps.Store,
			k8s:            deps.K8s,
			namespace:      deps.Namespace,
			defaultExec:    deps.DefaultExec,
			sparkImage:     deps.SparkImage,
			serviceAccount: deps.ServiceAccount,
			sparkConf:      deps.SparkConf,
		}
		r.Post("/clusters", clh.create)
		r.Get("/clusters", clh.list)
		r.Get("/clusters/{id}", clh.get)
		r.Delete("/clusters/{id}", clh.delete)
		r.Patch("/clusters/{id}", clh.patch)
		r.Post("/clusters/{id}/start", clh.start)
		r.Post("/clusters/{id}/stop", clh.stop)
		r.Post("/clusters/{id}/restart", clh.restart)
		r.Post("/clusters/{id}/clone", clh.clone)
		r.Get("/clusters/{id}/events", clh.events)
		r.Get("/clusters/{id}/logs", clh.logs)
		r.Get("/clusters/{id}/metrics", clh.metrics)
	})

	return r
}

// healthz is the liveness handler; no auth required.
func healthz(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("OK\n"))
}
