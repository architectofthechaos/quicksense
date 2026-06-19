// SPDX-License-Identifier: Apache-2.0

package httpapi_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	httpapi "github.com/deepiq/quicksense/api/internal/http"
)

func TestWriteJSON(t *testing.T) {
	payload := map[string]string{"hello": "world"}
	w := httptest.NewRecorder()
	httpapi.WriteJSON(w, http.StatusCreated, payload)

	if w.Code != http.StatusCreated {
		t.Errorf("status = %d; want 201", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q; want application/json", ct)
	}

	var got map[string]string
	if err := json.NewDecoder(w.Body).Decode(&got); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if got["hello"] != "world" {
		t.Errorf("body[hello] = %q; want world", got["hello"])
	}
}

func TestWriteError(t *testing.T) {
	w := httptest.NewRecorder()
	httpapi.WriteError(w, http.StatusUnauthorized, "unauthorized", "token is missing")

	if w.Code != http.StatusUnauthorized {
		t.Errorf("status = %d; want 401", w.Code)
	}
	if ct := w.Header().Get("Content-Type"); ct != "application/json" {
		t.Errorf("Content-Type = %q; want application/json", ct)
	}

	// Expect envelope: {"error":{"code":"unauthorized","message":"token is missing"}}
	var envelope struct {
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(w.Body).Decode(&envelope); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	if envelope.Error.Code != "unauthorized" {
		t.Errorf("error.code = %q; want unauthorized", envelope.Error.Code)
	}
	if envelope.Error.Message != "token is missing" {
		t.Errorf("error.message = %q; want token is missing", envelope.Error.Message)
	}
}
