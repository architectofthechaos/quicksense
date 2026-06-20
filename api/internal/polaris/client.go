// SPDX-License-Identifier: Apache-2.0

// Package polaris is the Go proxy client for the Apache Polaris management
// and Iceberg REST catalog APIs. The API is the only caller; clients never
// talk to Polaris directly.
//
// Authentication uses the OAuth2 client-credentials flow mirroring
// scripts/lib/bootstrap-common.sh: POST to /api/catalog/v1/oauth/tokens with
// HTTP Basic (clientID:secret), Polaris-Realm header, and the form body
// grant_type=client_credentials&scope=PRINCIPAL_ROLE:ALL. The resulting access
// token is cached and reused until near expiry.
package polaris

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

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

// Catalog is a minimal representation of a Polaris catalog.
type Catalog struct {
	Name string `json:"name"`
	Type string `json:"type"`
}

// Table is a minimal representation of an Iceberg table identifier.
type Table struct {
	Name      string
	Namespace string
}

// CreateCatalogParams carries the fields needed to create a Polaris catalog
// with an S3-compatible (MinIO) storage config, mirroring the payload in
// scripts/lib/bootstrap-common.sh:ensure_polaris_catalog.
type CreateCatalogParams struct {
	// Name is the catalog name (e.g. "quicksense").
	Name string
	// Bucket is the S3 bucket name (e.g. "warehouse").
	Bucket string
	// S3Endpoint is the full endpoint URL (e.g. "http://minio:9000").
	S3Endpoint string
	// Region is the S3 region (e.g. "us-east-1").
	Region string
}

// CreateTableParams carries the minimum fields to create an Iceberg table via
// the Iceberg REST catalog API.
type CreateTableParams struct {
	// Name is the table name.
	Name string
	// Location overrides the default base location (optional).
	Location string
}

// APIError is returned by HTTPClient for any non-2xx Polaris response.
// Handlers in B8 can inspect Status to translate the upstream HTTP status.
type APIError struct {
	Status int
	Body   string
}

func (e *APIError) Error() string {
	return fmt.Sprintf("polaris API error: status=%d body=%s", e.Status, e.Body)
}

// ---------------------------------------------------------------------------
// Client interface
// ---------------------------------------------------------------------------

// Client is the Polaris proxy contract consumed by the catalog/table handlers.
// All implementations must be safe for concurrent use.
type Client interface {
	ListCatalogs(ctx context.Context) ([]Catalog, error)
	CreateCatalog(ctx context.Context, p CreateCatalogParams) (*Catalog, error)
	ListTables(ctx context.Context, catalog, namespace string) ([]Table, error)
	CreateTable(ctx context.Context, catalog, namespace string, p CreateTableParams) (*Table, error)
}

// Compile-time interface check.
var _ Client = (*HTTPClient)(nil)

// ---------------------------------------------------------------------------
// HTTPClient — production implementation
// ---------------------------------------------------------------------------

// HTTPClient proxies requests to a Polaris server.
// Create via NewHTTPClient; safe for concurrent use after construction.
type HTTPClient struct {
	baseURL  string
	realm    string
	clientID string
	secret   string
	hc       *http.Client

	mu          sync.Mutex
	cachedToken string
	tokenExpiry time.Time
}

// tokenExpiryMargin is how far before the real expiry we treat the token as
// stale and proactively refresh.
const tokenExpiryMargin = 30 * time.Second

// NewHTTPClient constructs an HTTPClient.
//
//   - baseURL: scheme+host+optional port of the Polaris server (no trailing slash).
//   - realm:    Polaris realm header value (e.g. "POLARIS").
//   - clientID: OAuth2 client id for Basic auth (e.g. "root").
//   - secret:   OAuth2 client secret (e.g. "s3cr3t").
//   - hc:       http.Client to use; pass nil to use http.DefaultClient.
func NewHTTPClient(baseURL, realm, clientID, secret string, hc *http.Client) (*HTTPClient, error) {
	if baseURL == "" {
		return nil, fmt.Errorf("polaris: baseURL must not be empty")
	}
	if hc == nil {
		hc = http.DefaultClient
	}
	return &HTTPClient{
		baseURL:  strings.TrimRight(baseURL, "/"),
		realm:    realm,
		clientID: clientID,
		secret:   secret,
		hc:       hc,
	}, nil
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

// token returns a valid access token, fetching and caching one if needed.
// Callers hold mu before calling — this method does NOT lock.
func (c *HTTPClient) tokenLocked(ctx context.Context) (string, error) {
	if c.cachedToken != "" && time.Now().Add(tokenExpiryMargin).Before(c.tokenExpiry) {
		return c.cachedToken, nil
	}
	return c.fetchToken(ctx)
}

// fetchToken performs the OAuth2 client-credentials grant against Polaris.
// POST /api/catalog/v1/oauth/tokens  HTTP Basic clientID:secret
// Header: Polaris-Realm: <realm>
// Body:   grant_type=client_credentials&scope=PRINCIPAL_ROLE:ALL
//
// The caller must hold c.mu before invoking this method.
func (c *HTTPClient) fetchToken(ctx context.Context) (string, error) {
	endpoint := c.baseURL + "/api/catalog/v1/oauth/tokens"

	form := url.Values{}
	form.Set("grant_type", "client_credentials")
	form.Set("scope", "PRINCIPAL_ROLE:ALL")

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("polaris: build token request: %w", err)
	}
	req.SetBasicAuth(c.clientID, c.secret)
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.Header.Set("Polaris-Realm", c.realm)

	resp, err := c.hc.Do(req)
	if err != nil {
		return "", fmt.Errorf("polaris: token request: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("polaris: read token response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", &APIError{Status: resp.StatusCode, Body: string(body)}
	}

	var tok struct {
		AccessToken string `json:"access_token"`
		ExpiresIn   int    `json:"expires_in"`
	}
	if err := json.Unmarshal(body, &tok); err != nil {
		return "", fmt.Errorf("polaris: parse token response: %w", err)
	}
	if tok.AccessToken == "" {
		return "", fmt.Errorf("polaris: empty access_token in response")
	}

	expiry := time.Now().Add(time.Duration(tok.ExpiresIn) * time.Second)
	if tok.ExpiresIn == 0 {
		// Default to 1 hour if not provided.
		expiry = time.Now().Add(1 * time.Hour)
	}
	c.cachedToken = tok.AccessToken
	c.tokenExpiry = expiry
	return tok.AccessToken, nil
}

// ---------------------------------------------------------------------------
// doManagement builds and executes a management API request with auth headers.
// ---------------------------------------------------------------------------

func (c *HTTPClient) doManagement(ctx context.Context, method, path string, reqBody io.Reader) (*http.Response, []byte, error) {
	c.mu.Lock()
	tok, err := c.tokenLocked(ctx)
	c.mu.Unlock()
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Polaris-Realm", c.realm)
	req.Header.Set("Accept", "application/json")
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: read response body: %w", err)
	}
	return resp, body, nil
}

// doCatalog is like doManagement but for the Iceberg catalog API.
func (c *HTTPClient) doCatalog(ctx context.Context, method, path string, reqBody io.Reader) (*http.Response, []byte, error) {
	c.mu.Lock()
	tok, err := c.tokenLocked(ctx)
	c.mu.Unlock()
	if err != nil {
		return nil, nil, err
	}

	req, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, reqBody)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: build catalog request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+tok)
	req.Header.Set("Polaris-Realm", c.realm)
	req.Header.Set("Accept", "application/json")
	if reqBody != nil {
		req.Header.Set("Content-Type", "application/json")
	}

	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: catalog request %s %s: %w", method, path, err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, nil, fmt.Errorf("polaris: read catalog response body: %w", err)
	}
	return resp, body, nil
}

// ---------------------------------------------------------------------------
// Client interface implementation
// ---------------------------------------------------------------------------

// ListCatalogs returns all catalogs from the Polaris management API.
// GET /api/management/v1/catalogs
func (c *HTTPClient) ListCatalogs(ctx context.Context) ([]Catalog, error) {
	resp, body, err := c.doManagement(ctx, http.MethodGet, "/api/management/v1/catalogs", nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{Status: resp.StatusCode, Body: string(body)}
	}

	var result struct {
		Catalogs []Catalog `json:"catalogs"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("polaris: parse list-catalogs response: %w", err)
	}
	return result.Catalogs, nil
}

// CreateCatalog creates a Polaris catalog with S3-compatible storage config.
// The payload mirrors scripts/lib/bootstrap-common.sh:ensure_polaris_catalog.
// POST /api/management/v1/catalogs
func (c *HTTPClient) CreateCatalog(ctx context.Context, p CreateCatalogParams) (*Catalog, error) {
	baseLocation := fmt.Sprintf("s3://%s/%s", p.Bucket, p.Name)

	payload := map[string]any{
		"catalog": map[string]any{
			"name":     p.Name,
			"type":     "INTERNAL",
			"readOnly": false,
			"properties": map[string]any{
				"default-base-location": baseLocation,
			},
			"storageConfigInfo": map[string]any{
				"storageType":      "S3",
				"allowedLocations": []string{baseLocation},
				"endpoint":         p.S3Endpoint,
				"endpointInternal": p.S3Endpoint,
				"pathStyleAccess":  true,
				"region":           p.Region,
				"stsUnavailable":   true,
			},
		},
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("polaris: marshal create-catalog payload: %w", err)
	}

	resp, body, err := c.doManagement(ctx, http.MethodPost, "/api/management/v1/catalogs", bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{Status: resp.StatusCode, Body: string(body)}
	}

	// Response shape: {"catalog":{"name":...,"type":...}}
	var result struct {
		Catalog Catalog `json:"catalog"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("polaris: parse create-catalog response: %w", err)
	}
	return &result.Catalog, nil
}

// ListTables returns table identifiers in the given namespace, using the
// Iceberg REST catalog API.
// GET /api/catalog/v1/{catalog}/namespaces/{namespace}/tables
func (c *HTTPClient) ListTables(ctx context.Context, catalog, namespace string) ([]Table, error) {
	path := fmt.Sprintf("/api/catalog/v1/%s/namespaces/%s/tables",
		url.PathEscape(catalog), url.PathEscape(namespace))

	resp, body, err := c.doCatalog(ctx, http.MethodGet, path, nil)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{Status: resp.StatusCode, Body: string(body)}
	}

	// Iceberg REST: {"identifiers":[{"namespace":["demo"],"name":"events"}]}
	var result struct {
		Identifiers []struct {
			Namespace []string `json:"namespace"`
			Name      string   `json:"name"`
		} `json:"identifiers"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		return nil, fmt.Errorf("polaris: parse list-tables response: %w", err)
	}

	tables := make([]Table, 0, len(result.Identifiers))
	for _, id := range result.Identifiers {
		ns := ""
		if len(id.Namespace) > 0 {
			ns = id.Namespace[0]
		}
		tables = append(tables, Table{
			Name:      id.Name,
			Namespace: ns,
		})
	}
	return tables, nil
}

// CreateTable creates an Iceberg table in the given catalog + namespace.
// POST /api/catalog/v1/{catalog}/namespaces/{namespace}/tables
//
// The table schema is minimal but valid: a single required long column "id".
func (c *HTTPClient) CreateTable(ctx context.Context, catalog, namespace string, p CreateTableParams) (*Table, error) {
	path := fmt.Sprintf("/api/catalog/v1/%s/namespaces/%s/tables",
		url.PathEscape(catalog), url.PathEscape(namespace))

	// Minimal valid Iceberg schema: one integer column "id".
	payload := map[string]any{
		"name": p.Name,
		"schema": map[string]any{
			"type": "struct",
			"fields": []map[string]any{
				{
					"id":       1,
					"name":     "id",
					"required": true,
					"type":     "long",
				},
			},
		},
	}
	if p.Location != "" {
		payload["location"] = p.Location
	}

	b, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("polaris: marshal create-table payload: %w", err)
	}

	resp, body, err := c.doCatalog(ctx, http.MethodPost, path, bytes.NewReader(b))
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, &APIError{Status: resp.StatusCode, Body: string(body)}
	}

	// Iceberg REST create-table response: {"metadata-location":...,"metadata":{...}}
	// Extract the table name from the metadata.
	var result struct {
		Metadata struct {
			TableUUID string `json:"table-uuid"`
		} `json:"metadata"`
	}
	if err := json.Unmarshal(body, &result); err != nil {
		// Non-fatal — still return the table with the name we sent.
		return &Table{Name: p.Name, Namespace: namespace}, nil
	}
	return &Table{Name: p.Name, Namespace: namespace}, nil
}
