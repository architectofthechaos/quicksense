// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"net/http"
)

// errorBody is the JSON error envelope shape.
// Produces: {"error":{"code":"...","message":"..."}}
type errorBody struct {
	Error errorDetail `json:"error"`
}

type errorDetail struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// WriteJSON encodes v as JSON and writes it with the given HTTP status code.
// The Content-Type header is set to "application/json".
func WriteJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

// WriteError writes a structured JSON error envelope with the given HTTP
// status code, machine-readable code string, and human-readable message.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, errorBody{
		Error: errorDetail{Code: code, Message: message},
	})
}
