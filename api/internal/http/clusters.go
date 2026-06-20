// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"regexp"
	"strings"

	"github.com/go-chi/chi/v5"
	k8serrors "k8s.io/apimachinery/pkg/api/errors"

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

// list handles GET /v1/clusters.
// For each DB row it calls k8s.Get to merge live phase; a missing CR is
// tolerated (phase "Unknown") so the list never fails due to a gone CR.
func (h *clusterHandler) list(w http.ResponseWriter, r *http.Request) {
	clusters, err := h.store.ListClusters(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to list clusters")
		return
	}

	results := make([]clusterResponse, 0, len(clusters))
	for _, c := range clusters {
		status, err := h.k8s.Get(r.Context(), c.CRName)
		if err != nil {
			if k8serrors.IsNotFound(err) {
				// Tolerate a missing CR — report phase as "Unknown".
				status = k8s.ClusterStatus{Name: c.CRName, Phase: "Unknown"}
			} else {
				// Non-NotFound errors degrade the entry but don't fail the list.
				log.Printf("WARN: k8s.Get(%q) failed: %v", c.CRName, err)
				status = k8s.ClusterStatus{Name: c.CRName, Phase: "Unknown"}
			}
		}
		results = append(results, toClusterResponse(c, status))
	}

	WriteJSON(w, http.StatusOK, map[string]any{"clusters": results})
}

// get handles GET /v1/clusters/{id}.
// Returns 404 if the cluster is not found in the store.
func (h *clusterHandler) get(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	cluster, err := h.store.GetCluster(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "cluster not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to get cluster")
		return
	}

	status, err := h.k8s.Get(r.Context(), cluster.CRName)
	if err != nil {
		if k8serrors.IsNotFound(err) {
			status = k8s.ClusterStatus{Name: cluster.CRName, Phase: "Unknown"}
		} else {
			log.Printf("WARN: k8s.Get(%q) failed: %v", cluster.CRName, err)
			status = k8s.ClusterStatus{Name: cluster.CRName, Phase: "Unknown"}
		}
	}

	WriteJSON(w, http.StatusOK, toClusterResponse(*cluster, status))
}

// delete handles DELETE /v1/clusters/{id}.
// It deletes the k8s CR (tolerating a k8s NotFound so the operation is
// idempotent), then removes the DB row. Returns 204 on success.
func (h *clusterHandler) delete(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")

	cluster, err := h.store.GetCluster(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "cluster not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to get cluster")
		return
	}

	if err := h.k8s.Delete(r.Context(), cluster.CRName); err != nil {
		// Tolerate k8s NotFound — CR may have been deleted out-of-band.
		if !k8serrors.IsNotFound(err) {
			WriteError(w, http.StatusBadGateway, "provision_error", "failed to delete SparkConnect CR: "+err.Error())
			return
		}
	}

	if err := h.store.DeleteCluster(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			// Already gone from DB — still succeed.
			w.WriteHeader(http.StatusNoContent)
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to delete cluster record")
		return
	}

	w.WriteHeader(http.StatusNoContent)
}
