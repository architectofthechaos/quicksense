// SPDX-License-Identifier: Apache-2.0

// Command quicksense-api is the QuickSense control-plane HTTP server.
package main

import (
	"log"
	"net/http"

	httpapi "github.com/deepiq/quicksense/api/internal/http"
)

func main() {
	r := httpapi.NewRouter(httpapi.RouterDeps{})
	log.Println("quicksense-api listening on :8080")
	if err := http.ListenAndServe(":8080", r); err != nil {
		log.Fatalf("server error: %v", err)
	}
}
