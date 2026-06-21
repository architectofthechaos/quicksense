// SPDX-License-Identifier: Apache-2.0

// Package authz is the server-side authorization model for QuickSense: a small,
// object-level permission system (object_type, object_id, principal, level)
// enforced in the API. The UI only reflects what this package decides.
package authz

// Grant is a stored permission: a principal (user or group) holding a level on
// a specific object.
type Grant struct {
	ObjectType    string `json:"object_type"`
	ObjectID      string `json:"object_id"`
	PrincipalType string `json:"principal_type"` // "user" | "group"
	PrincipalID   string `json:"principal_id"`
	Level         string `json:"level"`
}

// Principal is the authenticated caller resolved from the Keycloak JWT.
type Principal struct {
	Username string
	Groups   []string
	Admin    bool // realm-admin ⇒ implicit manage on everything
}

// ladders define each object type's ordered levels (lowest → highest). A higher
// level implies every lower one.
var ladders = map[string][]string{
	"cluster":  {"attach", "manage"},
	"notebook": {"view", "run", "edit", "manage"},
	"table":    {"read", "write", "manage"},
}

// rank returns the ordinal of level within its object type's ladder, or -1 if
// the level is unknown for that type.
func rank(objectType, level string) int {
	for i, l := range ladders[objectType] {
		if l == level {
			return i
		}
	}
	return -1
}

// top returns the highest level for an object type (the implicit owner/admin level).
func top(objectType string) string {
	ladder := ladders[objectType]
	if len(ladder) == 0 {
		return ""
	}
	return ladder[len(ladder)-1]
}

// matches reports whether a grant applies to the principal (direct user match or
// one of the principal's groups).
func (g Grant) matches(p Principal) bool {
	switch g.PrincipalType {
	case "user":
		return g.PrincipalID == p.Username
	case "group":
		for _, grp := range p.Groups {
			if grp == g.PrincipalID {
				return true
			}
		}
	}
	return false
}

// Effective returns the highest level the principal holds on (objectType,
// objectID), considering admin, ownership, and direct/group grants. Returns ""
// when the principal has no access.
func Effective(objectType, objectID string, grants []Grant, p Principal, owner string) string {
	if p.Admin || (owner != "" && owner == p.Username) {
		return top(objectType)
	}
	best := -1
	for _, g := range grants {
		if g.ObjectType != objectType || g.ObjectID != objectID {
			continue
		}
		if !g.matches(p) {
			continue
		}
		if r := rank(objectType, g.Level); r > best {
			best = r
		}
	}
	if best < 0 {
		return ""
	}
	return ladders[objectType][best]
}

// Allows reports whether the principal's effective level on the object is at
// least `required`. Unknown required levels deny.
func Allows(objectType, objectID string, grants []Grant, p Principal, owner, required string) bool {
	want := rank(objectType, required)
	if want < 0 {
		return false
	}
	return rank(objectType, Effective(objectType, objectID, grants, p, owner)) >= want
}

// ValidLevel reports whether level is a defined level for objectType.
func ValidLevel(objectType, level string) bool {
	return rank(objectType, level) >= 0
}
