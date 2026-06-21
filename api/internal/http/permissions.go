// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/authz"
	"github.com/deepiq/quicksense/api/internal/store"
)

// permHandler serves object-level permission routes for a fixed object type
// (e.g. "cluster", "notebook"). Grant/revoke/list back the Permissions tabs.
type permHandler struct {
	store      store.Store
	objectType string
}

type permissionResponse struct {
	PrincipalType string `json:"principal_type"`
	PrincipalID   string `json:"principal_id"`
	Level         string `json:"level"`
	GrantedBy     string `json:"granted_by,omitempty"`
}

// list handles GET /v1/{object}/{id}/permissions.
func (h *permHandler) list(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	perms, err := h.store.ListPermissions(r.Context(), h.objectType, id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to list permissions")
		return
	}
	out := make([]permissionResponse, 0, len(perms))
	for _, p := range perms {
		out = append(out, permissionResponse{PrincipalType: p.PrincipalType, PrincipalID: p.PrincipalID, Level: p.Level, GrantedBy: p.GrantedBy})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"object_type": h.objectType, "permissions": out})
}

// grant handles PUT /v1/{object}/{id}/permissions {principal_type, principal_id, level}.
func (h *permHandler) grant(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		PrincipalType string `json:"principal_type"`
		PrincipalID   string `json:"principal_id"`
		Level         string `json:"level"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	if req.PrincipalType != "user" && req.PrincipalType != "group" {
		WriteError(w, http.StatusBadRequest, "bad_principal", "principal_type must be 'user' or 'group'")
		return
	}
	if req.PrincipalID == "" {
		WriteError(w, http.StatusBadRequest, "bad_principal", "principal_id is required")
		return
	}
	if !authz.ValidLevel(h.objectType, req.Level) {
		WriteError(w, http.StatusBadRequest, "bad_level", "invalid level for "+h.objectType)
		return
	}
	perm, err := h.store.GrantPermission(r.Context(), store.GrantParams{
		ObjectType: h.objectType, ObjectID: id,
		PrincipalType: req.PrincipalType, PrincipalID: req.PrincipalID, Level: req.Level,
	})
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to grant permission")
		return
	}
	WriteJSON(w, http.StatusOK, permissionResponse{PrincipalType: perm.PrincipalType, PrincipalID: perm.PrincipalID, Level: perm.Level, GrantedBy: perm.GrantedBy})
}

// revoke handles DELETE /v1/{object}/{id}/permissions?principal_type=&principal_id=.
func (h *permHandler) revoke(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	pt := r.URL.Query().Get("principal_type")
	pid := r.URL.Query().Get("principal_id")
	if pt == "" || pid == "" {
		WriteError(w, http.StatusBadRequest, "bad_principal", "principal_type and principal_id query params are required")
		return
	}
	if err := h.store.RevokePermission(r.Context(), h.objectType, id, pt, pid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "grant not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to revoke permission")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
