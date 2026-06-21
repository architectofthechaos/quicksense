// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/keycloak"
)

func adminMux(kc keycloak.AdminClient, v auth.TokenVerifier) http.Handler {
	return NewRouter(RouterDeps{Verifier: v, Polaris: &fakePolaris{}, KeycloakAdmin: kc})
}

func TestAdminEndpoints(t *testing.T) {
	kc := &fakeKeycloak{
		users:  []keycloak.User{{ID: "u1", Username: "alice", Enabled: true}},
		groups: []keycloak.Group{{ID: "g1", Name: "data"}},
	}

	// non-admin (only polaris_admin) is forbidden.
	nonAdmin := adminMux(kc, fakeVerifierAs{username: "bob", roles: []string{"polaris_admin"}})
	w := httptest.NewRecorder()
	nonAdmin.ServeHTTP(w, authReq(http.MethodGet, "/v1/admin/users", nil))
	if w.Code != http.StatusForbidden {
		t.Fatalf("non-admin list users: expected 403, got %d", w.Code)
	}

	admin := adminMux(kc, fakeVerifierAs{username: "root", roles: []string{"polaris_admin", "quicksense_admin"}})

	// list users
	w = httptest.NewRecorder()
	admin.ServeHTTP(w, authReq(http.MethodGet, "/v1/admin/users", nil))
	if w.Code != http.StatusOK {
		t.Fatalf("list users: %d %s", w.Code, w.Body.String())
	}
	var lr struct {
		Users []map[string]any `json:"users"`
	}
	json.Unmarshal(w.Body.Bytes(), &lr)
	if len(lr.Users) != 1 || lr.Users[0]["username"] != "alice" {
		t.Errorf("users: %+v", lr.Users)
	}

	// create user
	w = httptest.NewRecorder()
	admin.ServeHTTP(w, authReq(http.MethodPost, "/v1/admin/users", mustJSON(map[string]string{"username": "carol", "email": "carol@x.io"})))
	if w.Code != http.StatusCreated {
		t.Errorf("create user: %d %s", w.Code, w.Body.String())
	}

	// create group
	w = httptest.NewRecorder()
	admin.ServeHTTP(w, authReq(http.MethodPost, "/v1/admin/groups", mustJSON(map[string]string{"name": "eng"})))
	if w.Code != http.StatusCreated {
		t.Errorf("create group: %d %s", w.Code, w.Body.String())
	}

	// assign role
	w = httptest.NewRecorder()
	admin.ServeHTTP(w, authReq(http.MethodPut, "/v1/admin/users/u1/roles", mustJSON(map[string]string{"role": "polaris_admin"})))
	if w.Code != http.StatusNoContent {
		t.Errorf("assign role: %d %s", w.Code, w.Body.String())
	}
}
