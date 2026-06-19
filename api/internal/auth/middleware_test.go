// SPDX-License-Identifier: Apache-2.0

package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/deepiq/quicksense/api/internal/auth"
)

// fakeVerifier is a stub TokenVerifier for middleware tests — no crypto involved.
type fakeVerifier struct {
	principal *auth.Principal
	err       error
}

func (f *fakeVerifier) Verify(_ context.Context, _ string) (*auth.Principal, error) {
	return f.principal, f.err
}

// nextHandler is a downstream handler that records whether it was called and
// checks the principal is reachable via PrincipalFromContext.
type nextHandler struct {
	called    bool
	principal *auth.Principal
}

func (n *nextHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	n.called = true
	n.principal, _ = auth.PrincipalFromContext(r.Context())
	w.WriteHeader(http.StatusOK)
}

func TestRequireAuth_Middleware(t *testing.T) {
	okPrincipal := &auth.Principal{Username: "alice", Roles: []string{"polaris_admin"}}

	tests := []struct {
		name       string
		authHeader string
		verifier   *fakeVerifier
		wantStatus int
		wantCalled bool
		wantUser   string
	}{
		{
			name:       "no Authorization header",
			authHeader: "",
			verifier:   &fakeVerifier{principal: okPrincipal},
			wantStatus: http.StatusUnauthorized,
			wantCalled: false,
		},
		{
			name:       "non-Bearer scheme (Basic)",
			authHeader: "Basic YWxpY2U6cGFzcw==",
			verifier:   &fakeVerifier{principal: okPrincipal},
			wantStatus: http.StatusUnauthorized,
			wantCalled: false,
		},
		{
			name:       "ErrInvalidToken from verifier",
			authHeader: "Bearer some.bad.token",
			verifier:   &fakeVerifier{err: auth.ErrInvalidToken},
			wantStatus: http.StatusUnauthorized,
			wantCalled: false,
		},
		{
			name:       "ErrMissingRole from verifier",
			authHeader: "Bearer valid.but.no.role",
			verifier:   &fakeVerifier{err: auth.ErrMissingRole},
			wantStatus: http.StatusForbidden,
			wantCalled: false,
		},
		{
			name:       "valid token — downstream called with principal in context",
			authHeader: "Bearer valid.token",
			verifier:   &fakeVerifier{principal: okPrincipal},
			wantStatus: http.StatusOK,
			wantCalled: true,
			wantUser:   "alice",
		},
		{
			name:       "lowercase bearer scheme accepted (RFC 7235 case-insensitive)",
			authHeader: "bearer valid.token",
			verifier:   &fakeVerifier{principal: okPrincipal},
			wantStatus: http.StatusOK,
			wantCalled: true,
			wantUser:   "alice",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			next := &nextHandler{}
			handler := auth.RequireAuth(tc.verifier)(next)

			req := httptest.NewRequest(http.MethodGet, "/v1/test", nil)
			if tc.authHeader != "" {
				req.Header.Set("Authorization", tc.authHeader)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)

			if rec.Code != tc.wantStatus {
				t.Errorf("status = %d; want %d", rec.Code, tc.wantStatus)
			}
			if next.called != tc.wantCalled {
				t.Errorf("downstream called = %v; want %v", next.called, tc.wantCalled)
			}
			if tc.wantCalled && tc.wantUser != "" {
				if next.principal == nil {
					t.Fatalf("principal in context is nil; want %q", tc.wantUser)
				}
				if next.principal.Username != tc.wantUser {
					t.Errorf("principal.Username = %q; want %q", next.principal.Username, tc.wantUser)
				}
			}
		})
	}
}

// TestNewKeycloakVerifier_OfflineProd serves a JWKS from httptest.NewServer and
// exercises the full fetch+cache+verify path — NO Keycloak required.
func TestNewKeycloakVerifier_OfflineProd(t *testing.T) {
	const (
		testIss  = "http://keycloak-test:8080/realms/qs"
		kid      = "prod-kid-1"
		role     = "polaris_admin"
		username = "bob"
	)

	// Generate RSA keypair in-test.
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	// Build a JWKS JSON containing the public key.
	jwksJSON := buildJWKS(t, &priv.PublicKey, kid)

	// Serve it from an httptest server.
	jwksSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(jwksJSON)
	}))
	defer jwksSrv.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	v, err := auth.NewKeycloakVerifier(ctx, jwksSrv.URL, testIss, role)
	if err != nil {
		t.Fatalf("NewKeycloakVerifier: %v", err)
	}

	// Mint a valid token with the matching kid.
	tok := mintRS256Token(t, priv, kid, testIss, username, []string{role}, time.Now().Add(5*time.Minute))

	p, err := v.Verify(ctx, tok)
	if err != nil {
		t.Fatalf("Verify: %v", err)
	}
	if p.Username != username {
		t.Errorf("Username = %q; want %q", p.Username, username)
	}
	if len(p.Roles) == 0 || p.Roles[0] != role {
		t.Errorf("Roles = %v; want [%s]", p.Roles, role)
	}
}

// buildJWKS constructs a minimal JWKS JSON for an RSA public key.
// The n and e values are base64url-no-padding encoded per RFC 7517.
func buildJWKS(t *testing.T, pub *rsa.PublicKey, kid string) []byte {
	t.Helper()

	enc := base64.RawURLEncoding.EncodeToString

	nBytes := pub.N.Bytes()

	// Encode exponent as minimal big-endian bytes.
	e := pub.E
	var eBytes []byte
	for e > 0 {
		eBytes = append([]byte{byte(e & 0xff)}, eBytes...)
		e >>= 8
	}

	jwk := map[string]any{
		"kty": "RSA",
		"kid": kid,
		"use": "sig",
		"alg": "RS256",
		"n":   enc(nBytes),
		"e":   enc(eBytes),
	}
	jwks := map[string]any{
		"keys": []any{jwk},
	}
	raw, err := json.Marshal(jwks)
	if err != nil {
		t.Fatalf("marshal JWKS: %v", err)
	}
	return raw
}

// mintRS256Token creates a signed RS256 JWT for use in offline prod tests.
func mintRS256Token(t *testing.T, priv *rsa.PrivateKey, kid, issuer, username string, roles []string, exp time.Time) string {
	t.Helper()
	claims := jwt.MapClaims{
		"iss":                issuer,
		"sub":                username,
		"preferred_username": username,
		"exp":                exp.Unix(),
		"iat":                time.Now().Unix(),
		"realm_access": map[string]any{
			"roles": roles,
		},
	}
	tok := jwt.NewWithClaims(jwt.SigningMethodRS256, claims)
	tok.Header["kid"] = kid
	signed, err := tok.SignedString(priv)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return signed
}
