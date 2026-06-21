// SPDX-License-Identifier: Apache-2.0

// Package broker is the Go client for the QuickSense Python Spark-Connect
// execution broker. The API resolves a notebook's attached cluster to its
// sc:// endpoint and asks the broker to run a cell against it; the broker holds
// the pyspark[connect] session (Go has no Spark Connect client).
package broker

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
)

// RunResult is one cell's execution output. Stdout carries printed output
// (e.g. a DataFrame .show()); Error carries a traceback when the cell raised.
type RunResult struct {
	Stdout string `json:"stdout"`
	Error  string `json:"error,omitempty"`
}

// Client runs a cell's code against a Spark Connect endpoint via the broker.
type Client interface {
	Run(ctx context.Context, connectURL, code string) (*RunResult, error)
}

var _ Client = (*HTTPClient)(nil)

// HTTPClient talks to the broker's POST /run.
type HTTPClient struct {
	baseURL string
	hc      *http.Client
}

// NewHTTPClient builds a broker client. baseURL is the broker origin
// (e.g. http://spark-broker:8099).
func NewHTTPClient(baseURL string, hc *http.Client) *HTTPClient {
	if hc == nil {
		hc = http.DefaultClient
	}
	return &HTTPClient{baseURL: strings.TrimRight(baseURL, "/"), hc: hc}
}

// Run POSTs {connect_url, code} to the broker and returns the execution result.
func (c *HTTPClient) Run(ctx context.Context, connectURL, code string) (*RunResult, error) {
	payload, _ := json.Marshal(map[string]string{"connect_url": connectURL, "code": code})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.baseURL+"/run", bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("broker: run request: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("broker: status %d: %s", resp.StatusCode, string(body))
	}
	var out RunResult
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("broker: parse response: %w", err)
	}
	return &out, nil
}
