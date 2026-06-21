// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/polaris"
)

// tableHandler proxies table operations to the Polaris client.
// It contains no business logic — all validation and persistence is delegated.
type tableHandler struct {
	polaris polaris.Client
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
