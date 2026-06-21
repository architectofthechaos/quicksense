// SPDX-License-Identifier: Apache-2.0

// Package auth provides offline Keycloak JWT verification and chi middleware
// for the QuickSense control-plane API.
package auth

import (
	"context"
	"errors"
	"fmt"

	"github.com/golang-jwt/jwt/v5"
)

// Principal represents an authenticated caller.
type Principal struct {
	Username string
	Roles    []string
	Groups   []string
}

// TokenVerifier is the contract for validating a raw Bearer token.
// Implementations must be safe for concurrent use.
type TokenVerifier interface {
	Verify(ctx context.Context, raw string) (*Principal, error)
}

// ErrInvalidToken is returned when a token cannot be parsed or fails
// cryptographic / expiry validation.
var ErrInvalidToken = errors.New("invalid token")

// ErrMissingRole is returned when the token is valid but the caller does not
// hold the required Keycloak realm role.
var ErrMissingRole = errors.New("missing required role")

// KeycloakVerifier validates RS256 JWTs issued by Keycloak.
// The Keyfunc field is the injection seam: in production it is built from a
// background-refreshing JWKS cache (NewKeycloakVerifier); in tests a
// locally-generated RSA public key is injected directly — zero network.
type KeycloakVerifier struct {
	Keyfunc      jwt.Keyfunc
	Issuer       string
	RequiredRole string
}

// Verify parses raw, validates the signature + expiry + issuer, enforces
// RequiredRole from realm_access.roles, and returns a Principal on success.
func (v *KeycloakVerifier) Verify(_ context.Context, raw string) (*Principal, error) {
	parser := jwt.NewParser(
		jwt.WithValidMethods([]string{"RS256"}),
		jwt.WithIssuer(v.Issuer),
		jwt.WithExpirationRequired(),
	)

	var claims jwt.MapClaims
	_, err := parser.ParseWithClaims(raw, &claims, v.Keyfunc)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	// Extract realm_access.roles — Keycloak embeds roles here.
	roles, err := realmRoles(claims)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrInvalidToken, err)
	}

	// Enforce the required role.
	if !containsRole(roles, v.RequiredRole) {
		return nil, ErrMissingRole
	}

	// Build principal — prefer preferred_username, fall back to sub.
	username, _ := claims["preferred_username"].(string)
	if username == "" {
		username, _ = claims["sub"].(string)
	}

	return &Principal{
		Username: username,
		Roles:    roles,
		Groups:   stringSliceClaim(claims, "groups"),
	}, nil
}

// stringSliceClaim extracts an optional []string claim (e.g. Keycloak "groups").
// Missing or malformed → nil (groups are optional; absence just means no group
// membership for authorization).
func stringSliceClaim(claims jwt.MapClaims, key string) []string {
	raw, ok := claims[key].([]any)
	if !ok {
		return nil
	}
	out := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			out = append(out, s)
		}
	}
	return out
}

// realmRoles extracts the []string role list from realm_access.roles in claims.
func realmRoles(claims jwt.MapClaims) ([]string, error) {
	ra, ok := claims["realm_access"]
	if !ok {
		return nil, errors.New("realm_access claim missing")
	}
	raMap, ok := ra.(map[string]any)
	if !ok {
		return nil, errors.New("realm_access is not an object")
	}
	raw, ok := raMap["roles"]
	if !ok {
		return nil, errors.New("realm_access.roles claim missing")
	}
	rawSlice, ok := raw.([]any)
	if !ok {
		return nil, errors.New("realm_access.roles is not an array")
	}
	roles := make([]string, 0, len(rawSlice))
	for _, r := range rawSlice {
		s, ok := r.(string)
		if !ok {
			return nil, errors.New("realm_access.roles contains non-string element")
		}
		roles = append(roles, s)
	}
	return roles, nil
}

// containsRole reports whether target appears in roles.
func containsRole(roles []string, target string) bool {
	for _, r := range roles {
		if r == target {
			return true
		}
	}
	return false
}
