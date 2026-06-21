// SPDX-License-Identifier: Apache-2.0

package authz_test

import (
	"testing"

	"github.com/deepiq/quicksense/api/internal/authz"
)

func TestAllowsMatrix(t *testing.T) {
	grants := []authz.Grant{
		{ObjectType: "notebook", ObjectID: "nb1", PrincipalType: "user", PrincipalID: "alice", Level: "run"},
		{ObjectType: "notebook", ObjectID: "nb1", PrincipalType: "group", PrincipalID: "data", Level: "edit"},
		{ObjectType: "cluster", ObjectID: "c1", PrincipalType: "user", PrincipalID: "alice", Level: "attach"},
	}
	cases := []struct {
		name                            string
		objType, objID, required, owner string
		p                               authz.Principal
		want                            bool
	}{
		{"direct run implies view", "notebook", "nb1", "view", "", authz.Principal{Username: "alice"}, true},
		{"direct run allows run", "notebook", "nb1", "run", "", authz.Principal{Username: "alice"}, true},
		{"direct run denies edit", "notebook", "nb1", "edit", "", authz.Principal{Username: "alice"}, false},
		{"group edit allows edit", "notebook", "nb1", "edit", "", authz.Principal{Username: "bob", Groups: []string{"data"}}, true},
		{"group edit denies manage", "notebook", "nb1", "manage", "", authz.Principal{Username: "bob", Groups: []string{"data"}}, false},
		{"no grant denies", "notebook", "nb1", "view", "", authz.Principal{Username: "carol"}, false},
		{"owner gets manage", "notebook", "nb1", "manage", "carol", authz.Principal{Username: "carol"}, true},
		{"admin gets manage", "notebook", "nb1", "manage", "", authz.Principal{Username: "dave", Admin: true}, true},
		{"cluster attach allows attach", "cluster", "c1", "attach", "", authz.Principal{Username: "alice"}, true},
		{"cluster attach denies manage", "cluster", "c1", "manage", "", authz.Principal{Username: "alice"}, false},
		{"cross-object isolation", "notebook", "nb2", "view", "", authz.Principal{Username: "alice"}, false},
		{"unknown required denies", "notebook", "nb1", "bogus", "", authz.Principal{Username: "alice"}, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			if got := authz.Allows(c.objType, c.objID, grants, c.p, c.owner, c.required); got != c.want {
				t.Errorf("Allows(%s,%s,req=%s,owner=%s)=%v, want %v", c.objType, c.objID, c.required, c.owner, got, c.want)
			}
		})
	}
}

func TestEffective(t *testing.T) {
	grants := []authz.Grant{{ObjectType: "notebook", ObjectID: "nb1", PrincipalType: "user", PrincipalID: "alice", Level: "run"}}
	if got := authz.Effective("notebook", "nb1", grants, authz.Principal{Username: "alice"}, ""); got != "run" {
		t.Errorf("Effective(direct)=%q, want run", got)
	}
	if got := authz.Effective("notebook", "nb1", grants, authz.Principal{Username: "zzz"}, ""); got != "" {
		t.Errorf("Effective(no access)=%q, want empty", got)
	}
	if got := authz.Effective("notebook", "nb1", nil, authz.Principal{Username: "x", Admin: true}, ""); got != "manage" {
		t.Errorf("Effective(admin)=%q, want manage", got)
	}
	if got := authz.Effective("cluster", "c1", nil, authz.Principal{Username: "owner"}, "owner"); got != "manage" {
		t.Errorf("Effective(owner)=%q, want manage", got)
	}
}
