// SPDX-License-Identifier: Apache-2.0

package auth_test

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"errors"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/deepiq/quicksense/api/internal/auth"
)

const (
	testIssuer   = "http://keycloak:8080/realms/quicksense"
	testKID      = "test-kid-1"
	testRole     = "polaris_admin"
	testUsername = "alice"
)

// testKeyfunc returns a jwt.Keyfunc that validates against the provided RSA public key.
func testKeyfunc(pub *rsa.PublicKey) jwt.Keyfunc {
	return func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, jwt.ErrSignatureInvalid
		}
		return pub, nil
	}
}

// mintToken creates a signed RS256 JWT with the given claims adjustments.
func mintToken(t *testing.T, priv *rsa.PrivateKey, kid, issuer, username string, roles []string, exp time.Time) string {
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

func TestKeycloakVerifier_Verify(t *testing.T) {
	// Generate a test RSA keypair — all crypto happens in-process, zero network.
	priv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate RSA key: %v", err)
	}

	// A second RSA key for the "wrong-key" case.
	wrongPriv, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate wrong RSA key: %v", err)
	}

	kf := testKeyfunc(&priv.PublicKey)

	v := &auth.KeycloakVerifier{
		Keyfunc:      kf,
		Issuer:       testIssuer,
		RequiredRole: testRole,
	}

	future := time.Now().Add(10 * time.Minute)
	past := time.Now().Add(-10 * time.Minute)

	tests := []struct {
		name       string
		token      string
		wantErr    error
		wantUser   string
		wantRoles  []string
	}{
		{
			name:      "valid token with polaris_admin role",
			token:     mintToken(t, priv, testKID, testIssuer, testUsername, []string{testRole, "viewer"}, future),
			wantUser:  testUsername,
			wantRoles: []string{testRole, "viewer"},
		},
		{
			name:    "expired token",
			token:   mintToken(t, priv, testKID, testIssuer, testUsername, []string{testRole}, past),
			wantErr: auth.ErrInvalidToken,
		},
		{
			name:    "signed with wrong key",
			token:   mintToken(t, wrongPriv, testKID, testIssuer, testUsername, []string{testRole}, future),
			wantErr: auth.ErrInvalidToken,
		},
		{
			name:    "valid token but missing required role",
			token:   mintToken(t, priv, testKID, testIssuer, testUsername, []string{"other_role"}, future),
			wantErr: auth.ErrMissingRole,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p, err := v.Verify(context.Background(), tc.token)
			if tc.wantErr != nil {
				if err == nil {
					t.Fatalf("want error %v, got nil", tc.wantErr)
				}
				if !errors.Is(err, tc.wantErr) {
					t.Fatalf("want errors.Is(%v), got: %v", tc.wantErr, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if p.Username != tc.wantUser {
				t.Errorf("Username = %q; want %q", p.Username, tc.wantUser)
			}
			if len(p.Roles) != len(tc.wantRoles) {
				t.Errorf("Roles = %v; want %v", p.Roles, tc.wantRoles)
				return
			}
			for i, r := range tc.wantRoles {
				if p.Roles[i] != r {
					t.Errorf("Roles[%d] = %q; want %q", i, p.Roles[i], r)
				}
			}
		})
	}
}
