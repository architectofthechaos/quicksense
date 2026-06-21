// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/polaris"
)

// catalogHandler proxies catalog operations to the Polaris client.
// It contains no business logic — all validation and persistence is delegated.
type catalogHandler struct {
	polaris polaris.Client
}

// list handles GET /v1/catalogs.
// Returns: {"catalogs": [...]}
func (h *catalogHandler) list(w http.ResponseWriter, r *http.Request) {
	cats, err := h.polaris.ListCatalogs(r.Context())
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"catalogs": cats})
}

// listNamespaces handles GET /v1/catalogs/{catalog}/namespaces.
// Returns: {"namespaces": [...]}
func (h *catalogHandler) listNamespaces(w http.ResponseWriter, r *http.Request) {
	catalog := chi.URLParam(r, "catalog")
	ns, err := h.polaris.ListNamespaces(r.Context(), catalog)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"namespaces": ns})
}

// create handles POST /v1/catalogs.
// Expects a JSON body matching polaris.CreateCatalogParams.
// Returns: 201 with the created catalog.
func (h *catalogHandler) create(w http.ResponseWriter, r *http.Request) {
	var p polaris.CreateCatalogParams
	if err := json.NewDecoder(r.Body).Decode(&p); err != nil {
		WriteError(w, http.StatusBadRequest, "bad_request", "invalid JSON body: "+err.Error())
		return
	}

	cat, err := h.polaris.CreateCatalog(r.Context(), p)
	if err != nil {
		writeAPIError(w, err)
		return
	}
	WriteJSON(w, http.StatusCreated, cat)
}

// writeAPIError maps polaris errors to HTTP responses.
// *polaris.APIError → pass through its status code.
// Other errors      → 502 Bad Gateway.
func writeAPIError(w http.ResponseWriter, err error) {
	var apiErr *polaris.APIError
	if errors.As(err, &apiErr) {
		WriteError(w, apiErr.Status, "upstream_error", apiErr.Body)
		return
	}
	WriteError(w, http.StatusBadGateway, "upstream_error", err.Error())
}
