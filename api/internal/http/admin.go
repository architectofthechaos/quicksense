// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/keycloak"
)

// adminHandler serves the Users & Groups screen via the Keycloak Admin API (4e).
// All routes require the quicksense_admin realm role.
type adminHandler struct {
	kc keycloak.AdminClient
}

// requireAdmin gates on the admin role + a configured client. Returns false
// (after writing the error) when the caller may not proceed.
func (h *adminHandler) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok || !containsStr(p.Roles, notebookAdminRole) {
		WriteError(w, http.StatusForbidden, "forbidden", "the quicksense_admin role is required")
		return false
	}
	if h.kc == nil {
		WriteError(w, http.StatusNotImplemented, "unavailable", "the Keycloak Admin API is not configured")
		return false
	}
	return true
}

func (h *adminHandler) listUsers(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	users, err := h.kc.ListUsers(r.Context())
	if err != nil {
		WriteError(w, http.StatusBadGateway, "keycloak_error", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"users": users})
}

func (h *adminHandler) createUser(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		Username string `json:"username"`
		Email    string `json:"email"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Username) == "" {
		WriteError(w, http.StatusBadRequest, "bad_request", "username is required")
		return
	}
	u, err := h.kc.CreateUser(r.Context(), req.Username, req.Email)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "keycloak_error", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, u)
}

func (h *adminHandler) listGroups(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	groups, err := h.kc.ListGroups(r.Context())
	if err != nil {
		WriteError(w, http.StatusBadGateway, "keycloak_error", err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"groups": groups})
}

func (h *adminHandler) createGroup(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Name) == "" {
		WriteError(w, http.StatusBadRequest, "bad_request", "name is required")
		return
	}
	g, err := h.kc.CreateGroup(r.Context(), req.Name)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "keycloak_error", err.Error())
		return
	}
	WriteJSON(w, http.StatusCreated, g)
}

func (h *adminHandler) assignRole(w http.ResponseWriter, r *http.Request) {
	if !h.requireAdmin(w, r) {
		return
	}
	userID := chi.URLParam(r, "id")
	var req struct {
		Role string `json:"role"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Role) == "" {
		WriteError(w, http.StatusBadRequest, "bad_request", "role is required")
		return
	}
	if err := h.kc.AssignRealmRole(r.Context(), userID, req.Role); err != nil {
		WriteError(w, http.StatusBadGateway, "keycloak_error", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
