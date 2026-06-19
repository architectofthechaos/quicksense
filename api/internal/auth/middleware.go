// SPDX-License-Identifier: Apache-2.0

package auth

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/MicahParks/keyfunc/v3"
)

// principalKey is the unexported context key used to stash a *Principal.
type principalKey struct{}

// RequireAuth returns a chi-compatible middleware that validates a Bearer token
// from the Authorization header using the provided TokenVerifier.
//
//   - No header or non-Bearer scheme → 401 Unauthorized
//   - ErrInvalidToken → 401 Unauthorized
//   - ErrMissingRole → 403 Forbidden
//   - Success → stash *Principal in context and call next
func RequireAuth(v TokenVerifier) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			raw, ok := bearerToken(r)
			if !ok {
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			p, err := v.Verify(r.Context(), raw)
			if err != nil {
				if errors.Is(err, ErrMissingRole) {
					http.Error(w, "Forbidden", http.StatusForbidden)
					return
				}
				// ErrInvalidToken and any other verification error → 401.
				http.Error(w, "Unauthorized", http.StatusUnauthorized)
				return
			}

			ctx := context.WithValue(r.Context(), principalKey{}, p)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// PrincipalFromContext retrieves the *Principal stashed by RequireAuth.
// Returns (nil, false) if no principal is present.
func PrincipalFromContext(ctx context.Context) (*Principal, bool) {
	p, ok := ctx.Value(principalKey{}).(*Principal)
	return p, ok && p != nil
}

// bearerToken extracts the token string from an "Authorization: Bearer <t>"
// header. Returns ("", false) if the header is absent or uses a different scheme.
func bearerToken(r *http.Request) (string, bool) {
	hdr := r.Header.Get("Authorization")
	const prefix = "Bearer "
	// RFC 7235 §2.1: the auth-scheme token is case-insensitive ("bearer" == "Bearer").
	if len(hdr) < len(prefix) || !strings.EqualFold(hdr[:len(prefix)], prefix) {
		return "", false
	}
	tok := strings.TrimSpace(hdr[len(prefix):])
	if tok == "" {
		return "", false
	}
	return tok, true
}

// NewKeycloakVerifier constructs a *KeycloakVerifier whose Keyfunc is backed
// by a background-refreshing JWKS cache. It performs an initial fetch from
// jwksURL before returning; the context controls the lifecycle of the
// background refresh goroutine.
func NewKeycloakVerifier(ctx context.Context, jwksURL, issuer, requiredRole string) (*KeycloakVerifier, error) {
	kf, err := keyfunc.NewDefaultCtx(ctx, []string{jwksURL})
	if err != nil {
		return nil, err
	}
	return &KeycloakVerifier{
		Keyfunc:      kf.Keyfunc,
		Issuer:       issuer,
		RequiredRole: requiredRole,
	}, nil
}
