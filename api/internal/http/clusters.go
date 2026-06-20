// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/store"
)

// clusterHandler handles the /v1/clusters routes.
// It is a thin control-plane surface: it provisions SparkConnect CRs and
// records metadata in the store. It never runs Spark or touches table data.
type clusterHandler struct {
	store       store.Store
	k8s         k8s.SparkConnectClient
	namespace   string
	defaultExec int32
	sparkImage  string
}

// nonAlphanumRE matches any character that is not a lowercase letter, digit, or hyphen.
var nonAlphanumRE = regexp.MustCompile(`[^a-z0-9-]+`)

// sanitizeName converts a user-supplied cluster name to a DNS-1123-compatible
// fragment: lowercase, non-alphanumeric chars replaced with hyphens, leading/
// trailing hyphens trimmed.
func sanitizeName(name string) string {
	s := strings.ToLower(name)
	s = nonAlphanumRE.ReplaceAllString(s, "-")
	s = strings.Trim(s, "-")
	if s == "" {
		s = "cluster"
	}
	// Truncate so the whole CR name stays under 63 chars.
	// "qs-" (3) + s + "-" (1) + 8 hex chars = s must be ≤ 51.
	if len(s) > 51 {
		s = s[:51]
		s = strings.TrimRight(s, "-")
	}
	return s
}

// generateCRName returns a unique, RFC-1123-compliant CR name in the form
// qs-<sanitized>-<8 random hex chars>.
func generateCRName(userName string) (string, error) {
	buf := make([]byte, 4)
	if _, err := rand.Read(buf); err != nil {
		return "", fmt.Errorf("generate cr name: %w", err)
	}
	suffix := hex.EncodeToString(buf)
	return fmt.Sprintf("qs-%s-%s", sanitizeName(userName), suffix), nil
}

// clusterResponse is the JSON shape returned to callers for a single cluster.
type clusterResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	Namespace string `json:"namespace"`
	CRName    string `json:"cr_name"`
	Phase     string `json:"phase"`
	Ready     bool   `json:"ready"`
}

// toClusterResponse merges a store.Cluster row with the live k8s ClusterStatus.
func toClusterResponse(c store.Cluster, status k8s.ClusterStatus) clusterResponse {
	phase := string(c.Phase)
	if status.Phase != "" {
		phase = status.Phase
	}
	return clusterResponse{
		ID:        c.ID,
		Name:      c.Name,
		Namespace: c.Namespace,
		CRName:    c.CRName,
		Phase:     phase,
		Ready:     status.Ready,
	}
}

// create handles POST /v1/clusters.
// It generates a CR name, provisions a SparkConnect CR, then records the row
// in the store. If the k8s call fails, 502 is returned. If the DB insert fails
// after a successful k8s create, a log + 500 is returned; CR compensation is
// out of scope for this sprint.
// TODO: add rollback/compensation if DB insert fails after k8s CR creation (B-future).
func (h *clusterHandler) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name string `json:"name"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		WriteError(w, http.StatusBadRequest, "missing_name", "name is required")
		return
	}

	crName, err := generateCRName(req.Name)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "failed to generate cluster name")
		return
	}

	_, err = h.k8s.Create(r.Context(), k8s.ClusterSpec{
		Name:      crName,
		Image:     h.sparkImage,
		Executors: h.defaultExec,
	})
	if err != nil {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to provision SparkConnect CR: "+err.Error())
		return
	}

	cluster, err := h.store.CreateCluster(r.Context(), store.CreateClusterParams{
		Name:      req.Name,
		Namespace: h.namespace,
		CRName:    crName,
	})
	if err != nil {
		// TODO: CR was created but DB row failed — compensation/rollback out of scope (B-future).
		log.Printf("WARN: k8s CR %q created but DB insert failed: %v; manual cleanup may be required", crName, err)
		WriteError(w, http.StatusInternalServerError, "store_error", "cluster provisioned but metadata save failed")
		return
	}

	WriteJSON(w, http.StatusCreated, toClusterResponse(*cluster, k8s.ClusterStatus{}))
}

// list, get, delete — implemented in B13.
// Stubs satisfy the router mounts declared in router.go.

func (h *clusterHandler) list(w http.ResponseWriter, r *http.Request) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", "list clusters not yet implemented")
}

func (h *clusterHandler) get(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id")
	WriteError(w, http.StatusNotImplemented, "not_implemented", "get cluster not yet implemented")
}

func (h *clusterHandler) delete(w http.ResponseWriter, r *http.Request) {
	_ = chi.URLParam(r, "id")
	WriteError(w, http.StatusNotImplemented, "not_implemented", "delete cluster not yet implemented")
}
