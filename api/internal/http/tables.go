// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"strconv"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/polaris"
	"github.com/deepiq/quicksense/api/internal/trino"
)

// tableHandler proxies table operations to the Polaris client, and sample-data
// reads to Trino. It contains no business logic — all work is delegated.
type tableHandler struct {
	polaris      polaris.Client
	trino        trino.Client
	trinoCatalog string // Trino catalog name the Polaris catalog maps to (e.g. "iceberg")
}

// list handles GET /v1/catalogs/{catalog}/namespaces/{namespace}/tables.
// Returns: {"tables": [...]}
func (h *tableHandler) list(w http.ResponseWriter, r *http.Request) {
	catalog := chi.URLParam(r, "catalog")
	namespace := chi.URLParam(r, "namespace")

	tables, err := h.polaris.ListTables(r.Context(), catalog, namespace)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"tables": tables})
}

// create handles POST /v1/catalogs/{catalog}/namespaces/{namespace}/tables.
// Expects a JSON body matching polaris.CreateTableParams.
// Returns: 201 with the created table.
func (h *tableHandler) create(w http.ResponseWriter, r *http.Request) {
	catalog := chi.URLParam(r, "catalog")
	namespace := chi.URLParam(r, "namespace")

	var p polaris.CreateTableParams
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		WriteError(w, http.StatusBadRequest, "bad_request", "invalid JSON body: "+err.Error())
		return
	}

	table, err := h.polaris.CreateTable(r.Context(), catalog, namespace, p)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, table)
}

// get handles GET /v1/catalogs/{catalog}/namespaces/{namespace}/tables/{table}.
// Returns the normalized table metadata (columns, details, history).
func (h *tableHandler) get(w http.ResponseWriter, r *http.Request) {
	catalog := chi.URLParam(r, "catalog")
	namespace := chi.URLParam(r, "namespace")
	table := chi.URLParam(r, "table")

	tm, err := h.polaris.LoadTable(r.Context(), catalog, namespace, table)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, tm)
}

// sample handles GET /v1/catalogs/{catalog}/namespaces/{namespace}/tables/{table}/sample?limit=N.
// It executes SELECT * ... LIMIT N via Trino. The Polaris catalog maps to the
// configured Trino catalog (trinoCatalog); the namespace is the Trino schema.
func (h *tableHandler) sample(w http.ResponseWriter, r *http.Request) {
	if h.trino == nil {
		WriteError(w, http.StatusNotImplemented, "unavailable", "sample data requires Trino, which is not configured")
		return
	}
	namespace := chi.URLParam(r, "namespace")
	table := chi.URLParam(r, "table")

	limit := 100
	if q := r.URL.Query().Get("limit"); q != "" {
		if n, err := strconv.Atoi(q); err == nil && n > 0 {
			limit = n
		}
	}
	tc := h.trinoCatalog
	if tc == "" {
		tc = "iceberg"
	}

	res, err := h.trino.Sample(r.Context(), tc, namespace, table, limit)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "trino_error", "sample query failed: "+err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, res)
}
