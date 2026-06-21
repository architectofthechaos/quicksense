// SPDX-License-Identifier: Apache-2.0

// Package trino is a minimal client for the Trino REST query protocol, used by
// the API to fetch sample rows for the catalog browser. The API is the only
// caller; the UI never talks to Trino directly.
package trino

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/deepiq/quicksense/api/internal/auth"
)

// userFor returns the caller's username (per-user attribution, 4e) when present
// in ctx, else the configured service user.
func (c *HTTPClient) userFor(ctx context.Context) string {
	if p, ok := auth.PrincipalFromContext(ctx); ok && p.Username != "" {
		return p.Username
	}
	return c.user
}

// Result is a sample query result: column names + rows of arbitrary JSON values.
type Result struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
}

// Client fetches sample rows for a table.
type Client interface {
	Sample(ctx context.Context, catalog, schema, table string, limit int) (*Result, error)
}

// Compile-time interface check.
var _ Client = (*HTTPClient)(nil)

// HTTPClient speaks the Trino statement protocol (POST /v1/statement, then
// follow nextUri until the result set is drained).
type HTTPClient struct {
	baseURL string
	user    string
	hc      *http.Client
}

// NewHTTPClient builds an HTTPClient. baseURL is scheme+host+port (no trailing
// slash needed); user is the Trino session user (X-Trino-User).
func NewHTTPClient(baseURL, user string, hc *http.Client) *HTTPClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &HTTPClient{baseURL: strings.TrimRight(baseURL, "/"), user: user, hc: hc}
}

// queryResults is the subset of Trino's QueryResults we consume.
type queryResults struct {
	NextURI string `json:"nextUri"`
	Columns []struct {
		Name string `json:"name"`
		Type string `json:"type"`
	} `json:"columns"`
	Data  [][]any `json:"data"`
	Error *struct {
		Message string `json:"message"`
	} `json:"error"`
}

// quoteIdent double-quotes a Trino identifier, escaping embedded quotes.
func quoteIdent(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// Sample runs SELECT * FROM catalog.schema.table LIMIT n and returns the rows.
func (c *HTTPClient) Sample(ctx context.Context, catalog, schema, table string, limit int) (*Result, error) {
	if limit <= 0 {
		limit = 100
	}
	sql := fmt.Sprintf("SELECT * FROM %s.%s.%s LIMIT %d",
		quoteIdent(catalog), quoteIdent(schema), quoteIdent(table), limit)

	qr, err := c.post(ctx, sql)
	if err != nil {
		return nil, err
	}

	result := &Result{}
	for {
		if qr.Error != nil {
			return nil, fmt.Errorf("trino: query error: %s", qr.Error.Message)
		}
		if result.Columns == nil && len(qr.Columns) > 0 {
			for _, col := range qr.Columns {
				result.Columns = append(result.Columns, col.Name)
			}
		}
		result.Rows = append(result.Rows, qr.Data...)
		if qr.NextURI == "" {
			break
		}
		if qr, err = c.get(ctx, qr.NextURI); err != nil {
			return nil, err
		}
	}
	if result.Rows == nil {
		result.Rows = [][]any{}
	}
	return result, nil
}

func (c *HTTPClient) post(ctx context.Context, sql string) (*queryResults, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/v1/statement", strings.NewReader(sql))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Trino-User", c.userFor(ctx))
	req.Header.Set("Content-Type", "text/plain")
	return c.do(req)
}

func (c *HTTPClient) get(ctx context.Context, uri string) (*queryResults, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, uri, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Trino-User", c.userFor(ctx))
	return c.do(req)
}

func (c *HTTPClient) do(req *http.Request) (*queryResults, error) {
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("trino: request: %w", err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("trino: read body: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("trino: status %d: %s", resp.StatusCode, string(body))
	}
	var qr queryResults
	if err := json.Unmarshal(body, &qr); err != nil {
		return nil, fmt.Errorf("trino: parse response: %w", err)
	}
	return &qr, nil
}
