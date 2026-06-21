// SPDX-License-Identifier: Apache-2.0

// Package keycloak is the Go client for the Keycloak Admin REST API. The
// QuickSense API manages identities (users/groups/role assignment) through this
// client — the Keycloak UI is never embedded or modified (SPEC-004 4e).
package keycloak

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// User is a minimal Keycloak user representation.
type User struct {
	ID       string `json:"id,omitempty"`
	Username string `json:"username"`
	Email    string `json:"email,omitempty"`
	Enabled  bool   `json:"enabled"`
}

// Group is a minimal Keycloak group representation.
type Group struct {
	ID   string `json:"id,omitempty"`
	Name string `json:"name"`
}

// AdminClient is the identity-management contract consumed by the admin handlers.
type AdminClient interface {
	ListUsers(ctx context.Context) ([]User, error)
	CreateUser(ctx context.Context, username, email string) (*User, error)
	ListGroups(ctx context.Context) ([]Group, error)
	CreateGroup(ctx context.Context, name string) (*Group, error)
	AssignRealmRole(ctx context.Context, userID, role string) error
}

var _ AdminClient = (*HTTPAdminClient)(nil)

// HTTPAdminClient talks to the Keycloak Admin REST API using a client-credentials
// service account (the client must hold the realm-management roles).
type HTTPAdminClient struct {
	baseURL  string
	realm    string
	clientID string
	secret   string
	hc       *http.Client

	mu     sync.Mutex
	token  string
	expiry time.Time
}

// NewHTTPAdminClient builds an admin client. baseURL is the Keycloak origin
// (e.g. http://keycloak:8082), no trailing slash required.
func NewHTTPAdminClient(baseURL, realm, clientID, secret string, hc *http.Client) *HTTPAdminClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &HTTPAdminClient{baseURL: strings.TrimRight(baseURL, "/"), realm: realm, clientID: clientID, secret: secret, hc: hc}
}

const tokenMargin = 30 * time.Second

func (c *HTTPAdminClient) tokenLocked(ctx context.Context) (string, error) {
	if c.token != "" && time.Now().Add(tokenMargin).Before(c.expiry) {
		return c.token, nil
	}
	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("client_id", c.clientID)
	form.Set("client_secret", c.secret)
	endpoint := fmt.Sprintf("%s/realms/%s/protocol/openid-connect/token", c.baseURL, url.PathEscape(c.realm))
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := c.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("keycloak: token request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("keycloak: token status %d: %s", resp.StatusCode, string(body))
	}
	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("keycloak: parse token: %w", err)
	}
	c.token = tok.AccessToken
	exp := tok.ExpiresIn
	if exp == 0 {
		exp = 60
	}
	c.expiry = time.Now().Add(time.Duration(exp) * time.Second)
	return c.token, nil
}

// do issues an authenticated Admin API request and returns the response + body.
func (c *HTTPAdminClient) do(ctx context.Context, method, path string, payload any) (*http.Response, []byte, error) {
	c.mu.Lock()
	tok, err := c.tokenLocked(ctx)
	c.mu.Unlock()
	if err != nil {
		return nil, nil, err
	}
	var reader io.Reader
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return nil, nil, err
		}
		reader = bytes.NewReader(b)
	}
	endpoint := fmt.Sprintf("%s/admin/realms/%s%s", c.baseURL, url.PathEscape(c.realm), path)
	req, err := http.NewRequestWithContext(ctx, method, endpoint, reader)
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Accept", "application/json")
	if payload != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("keycloak: %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	return resp, body, nil
}

func (c *HTTPAdminClient) ListUsers(ctx context.Context) ([]User, error) {
	resp, body, err := c.do(ctx, http.MethodGet, "/users", nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("keycloak: list users status %d: %s", resp.StatusCode, string(body))
	}
	var users []User
	if err := json.Unmarshal(body, &users); err != nil {
		return nil, fmt.Errorf("keycloak: parse users: %w", err)
	}
	return users, nil
}

func (c *HTTPAdminClient) CreateUser(ctx context.Context, username, email string) (*User, error) {
	resp, body, err := c.do(ctx, http.MethodPost, "/users", User{Username: username, Email: email, Enabled: true})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("keycloak: create user status %d: %s", resp.StatusCode, string(body))
	}
	// Keycloak returns the new id in the Location header.
	id := ""
	if loc := resp.Header.Get("Location"); loc != "" {
		parts := strings.Split(strings.TrimRight(loc, "/"), "/")
		id = parts[len(parts)-1]
	}
	return &User{ID: id, Username: username, Email: email, Enabled: true}, nil
}

func (c *HTTPAdminClient) ListGroups(ctx context.Context) ([]Group, error) {
	resp, body, err := c.do(ctx, http.MethodGet, "/groups", nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("keycloak: list groups status %d: %s", resp.StatusCode, string(body))
	}
	var groups []Group
	if err := json.Unmarshal(body, &groups); err != nil {
		return nil, fmt.Errorf("keycloak: parse groups: %w", err)
	}
	return groups, nil
}

func (c *HTTPAdminClient) CreateGroup(ctx context.Context, name string) (*Group, error) {
	resp, body, err := c.do(ctx, http.MethodPost, "/groups", Group{Name: name})
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusCreated {
		return nil, fmt.Errorf("keycloak: create group status %d: %s", resp.StatusCode, string(body))
	}
	id := ""
	if loc := resp.Header.Get("Location"); loc != "" {
		parts := strings.Split(strings.TrimRight(loc, "/"), "/")
		id = parts[len(parts)-1]
	}
	return &Group{ID: id, Name: name}, nil
}

// AssignRealmRole grants a realm role to a user: look up the role representation,
// then POST it to the user's realm role-mappings.
func (c *HTTPAdminClient) AssignRealmRole(ctx context.Context, userID, role string) error {
	resp, body, err := c.do(ctx, http.MethodGet, "/roles/"+url.PathEscape(role), nil)
	if err != nil {
		return err
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("keycloak: get role %q status %d: %s", role, resp.StatusCode, string(body))
	}
	var rr struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.Unmarshal(body, &rr); err != nil {
		return fmt.Errorf("keycloak: parse role: %w", err)
	}
	resp2, body2, err := c.do(ctx, http.MethodPost,
		fmt.Sprintf("/users/%s/role-mappings/realm", url.PathEscape(userID)),
		[]map[string]string{{"id": rr.ID, "name": rr.Name}})
	if err != nil {
		return err
	}
	if resp2.StatusCode != http.StatusNoContent && resp2.StatusCode != http.StatusOK {
		return fmt.Errorf("keycloak: assign role status %d: %s", resp2.StatusCode, string(body2))
	}
	return nil
}
