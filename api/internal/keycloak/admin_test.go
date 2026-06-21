// SPDX-License-Identifier: Apache-2.0

package keycloak_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/deepiq/quicksense/api/internal/keycloak"
)

func TestAdminClient(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/realms/quicksense/protocol/openid-connect/token":
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"access_token":"adm","expires_in":300}`))
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/quicksense/users":
			if r.Header.Get("Authorization") != "Bearer adm" {
				http.Error(w, "no bearer", http.StatusUnauthorized)
				return
			}
			_, _ = w.Write([]byte(`[{"id":"u1","username":"alice","enabled":true}]`))
		case r.Method == http.MethodPost && r.URL.Path == "/admin/realms/quicksense/users":
			w.Header().Set("Location", srv.URL+"/admin/realms/quicksense/users/u2")
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/quicksense/groups":
			_, _ = w.Write([]byte(`[{"id":"g1","name":"data"}]`))
		case r.Method == http.MethodPost && r.URL.Path == "/admin/realms/quicksense/groups":
			w.Header().Set("Location", srv.URL+"/admin/realms/quicksense/groups/g2")
			w.WriteHeader(http.StatusCreated)
		case r.Method == http.MethodGet && r.URL.Path == "/admin/realms/quicksense/roles/polaris_admin":
			_, _ = w.Write([]byte(`{"id":"r1","name":"polaris_admin"}`))
		case r.Method == http.MethodPost && r.URL.Path == "/admin/realms/quicksense/users/u2/role-mappings/realm":
			w.WriteHeader(http.StatusNoContent)
		default:
			http.Error(w, "unexpected "+r.Method+" "+r.URL.Path, http.StatusNotFound)
		}
	}))
	defer srv.Close()

	c := keycloak.NewHTTPAdminClient(srv.URL, "quicksense", "quicksense-api", "secret", srv.Client())
	ctx := context.Background()

	users, err := c.ListUsers(ctx)
	if err != nil || len(users) != 1 || users[0].Username != "alice" {
		t.Fatalf("ListUsers: %v %+v", err, users)
	}
	u, err := c.CreateUser(ctx, "bob", "bob@x.io")
	if err != nil || u.ID != "u2" {
		t.Fatalf("CreateUser (Location id): %v %+v", err, u)
	}
	groups, err := c.ListGroups(ctx)
	if err != nil || len(groups) != 1 || groups[0].Name != "data" {
		t.Fatalf("ListGroups: %v %+v", err, groups)
	}
	g, err := c.CreateGroup(ctx, "eng")
	if err != nil || g.ID != "g2" {
		t.Fatalf("CreateGroup: %v %+v", err, g)
	}
	if err := c.AssignRealmRole(ctx, "u2", "polaris_admin"); err != nil {
		t.Fatalf("AssignRealmRole: %v", err)
	}
}
