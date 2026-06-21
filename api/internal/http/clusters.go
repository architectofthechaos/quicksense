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

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/authz"
	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/store"
)

// clusterHandler handles the /v1/clusters routes.
// It is a thin control-plane surface: it provisions SparkConnect CRs and
// records metadata in the store. It never runs Spark or touches table data.
type clusterHandler struct {
	store          store.Store
	k8s            k8s.SparkConnectClient
	namespace      string
	defaultExec    int32
	sparkImage     string
	serviceAccount string            // Kubernetes ServiceAccount for the driver pod
	sparkConf      map[string]string // Iceberg/catalog SparkConf entries
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
	ID           string          `json:"id"`
	Name         string          `json:"name"`
	Namespace    string          `json:"namespace"`
	CRName       string          `json:"cr_name"`
	Phase        string          `json:"phase"`
	Ready        bool            `json:"ready"`
	Pinned       bool            `json:"pinned"`
	DesiredState string          `json:"desired_state"`
	Config       json.RawMessage `json:"config,omitempty"`
}

// toClusterResponse merges a store.Cluster row with the live k8s ClusterStatus.
func toClusterResponse(c store.Cluster, status k8s.ClusterStatus) clusterResponse {
	phase := string(c.Phase)
	if status.Phase != "" {
		phase = status.Phase
	}
	return clusterResponse{
		ID:           c.ID,
		Name:         c.Name,
		Namespace:    c.Namespace,
		CRName:       c.CRName,
		Phase:        phase,
		Ready:        status.Ready,
		Pinned:       c.Pinned,
		DesiredState: c.DesiredState,
		Config:       c.Config,
	}
}

// resourcesReq is the JSON shape for per-container CPU/memory in the create body.
type resourcesReq struct {
	CPURequest    string `json:"cpu_request"`
	CPULimit      string `json:"cpu_limit"`
	MemoryRequest string `json:"memory_request"`
	MemoryLimit   string `json:"memory_limit"`
}

func (r resourcesReq) toK8s() k8s.Resources {
	return k8s.Resources{
		CPURequest:    r.CPURequest,
		CPULimit:      r.CPULimit,
		MemoryRequest: r.MemoryRequest,
		MemoryLimit:   r.MemoryLimit,
	}
}

// createClusterReq is the K8s-native cluster create body (identical everywhere —
// pod resources against existing cluster capacity; no cloud/instance fields).
type createClusterReq struct {
	Name        string            `json:"name"`
	WorkerMin   int32             `json:"worker_min"`
	WorkerMax   int32             `json:"worker_max"`
	Driver      resourcesReq      `json:"driver"`
	Executor    resourcesReq      `json:"executor"`
	Image       string            `json:"image"`        // advanced override; default = QuickSense Spark image
	IdleMinutes int               `json:"idle_minutes"` // auto-terminate; persisted with migration 0002
	SparkConf   map[string]string `json:"spark_conf"`
	Env         map[string]string `json:"env"`
	Tags        map[string]string `json:"tags"`
}

// create handles POST /v1/clusters.
// It generates a CR name, provisions a SparkConnect CR, then records the row
// in the store. If the k8s call fails, 502 is returned. If the DB insert fails
// after a successful k8s create, a log + 500 is returned; CR compensation is
// out of scope for this sprint.
// TODO: add rollback/compensation if DB insert fails after k8s CR creation (B-future).
func (h *clusterHandler) create(w http.ResponseWriter, r *http.Request) {
	var req createClusterReq
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

	if _, err = h.k8s.Create(r.Context(), h.buildSpec(crName, req)); err != nil {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to provision SparkConnect CR: "+err.Error())
		return
	}

	configJSON, _ := json.Marshal(req)
	cluster, err := h.store.CreateCluster(r.Context(), store.CreateClusterParams{
		Name:      req.Name,
		Namespace: h.namespace,
		CRName:    crName,
		Config:    configJSON,
		Owner:     callerName(r),
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
		if !h.authorize(r, &c, "attach") {
			continue // server-side scoping: only clusters the caller may attach
		}
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

	if !h.authorize(r, cluster, "attach") {
		forbid(w)
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

	if !h.authorize(r, cluster, "manage") {
		forbid(w)
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

// ---------------------------------------------------------------------------
// 4b lifecycle: start / stop / restart / clone / pin (PATCH)
// ---------------------------------------------------------------------------

// buildSpec renders a k8s.ClusterSpec from a create config — image fallback +
// catalog/user sparkConf merge. Shared by create / start / restart / clone so
// a stopped cluster restarts with exactly its persisted desired config.
func (h *clusterHandler) buildSpec(crName string, req createClusterReq) k8s.ClusterSpec {
	image := h.sparkImage
	if strings.TrimSpace(req.Image) != "" {
		image = req.Image
	}
	sparkConf := make(map[string]string, len(h.sparkConf)+len(req.SparkConf))
	for k, v := range h.sparkConf {
		sparkConf[k] = v
	}
	for k, v := range req.SparkConf {
		sparkConf[k] = v
	}
	return k8s.ClusterSpec{
		Name:           crName,
		Image:          image,
		Executors:      h.defaultExec,
		WorkerMin:      req.WorkerMin,
		WorkerMax:      req.WorkerMax,
		Driver:         req.Driver.toK8s(),
		Executor:       req.Executor.toK8s(),
		ServiceAccount: h.serviceAccount,
		SparkConf:      sparkConf,
		Env:            req.Env,
		Tags:           req.Tags,
	}
}

// loadConfig unmarshals a cluster's persisted create config (tolerant of empty).
func loadConfig(c *store.Cluster) createClusterReq {
	var req createClusterReq
	if len(c.Config) > 0 {
		_ = json.Unmarshal(c.Config, &req)
	}
	return req
}

// getClusterOr404 fetches a cluster, writing 404/500 and returning nil on failure.
func (h *clusterHandler) getClusterOr404(w http.ResponseWriter, r *http.Request, id string) *store.Cluster {
	c, err := h.store.GetCluster(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "cluster not found")
		} else {
			WriteError(w, http.StatusInternalServerError, "store_error", "failed to get cluster")
		}
		return nil
	}
	return c
}

// callerName returns the authenticated principal's username (owner attribution).
func callerName(r *http.Request) string {
	if p, ok := auth.PrincipalFromContext(r.Context()); ok {
		return p.Username
	}
	return ""
}

// authorize enforces object-level permission on a cluster: owner ⇒ manage,
// quicksense_admin ⇒ manage, otherwise the effective grant level must meet
// `level` ("attach" or "manage"). Server-side; the UI only reflects it.
func (h *clusterHandler) authorize(r *http.Request, c *store.Cluster, level string) bool {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		return false
	}
	perms, _ := h.store.ListPermissions(r.Context(), "cluster", c.ID)
	grants := make([]authz.Grant, 0, len(perms))
	for _, g := range perms {
		grants = append(grants, authz.Grant{
			ObjectType: g.ObjectType, ObjectID: g.ObjectID,
			PrincipalType: g.PrincipalType, PrincipalID: g.PrincipalID, Level: g.Level,
		})
	}
	ap := authz.Principal{Username: p.Username, Groups: p.Groups, Admin: containsStr(p.Roles, notebookAdminRole)}
	return authz.Allows("cluster", c.ID, grants, ap, c.Owner, level)
}

// getAuthorizedCluster fetches a cluster and enforces `level`, writing 404/403
// and returning nil on failure.
func (h *clusterHandler) getAuthorizedCluster(w http.ResponseWriter, r *http.Request, id, level string) *store.Cluster {
	c := h.getClusterOr404(w, r, id)
	if c == nil {
		return nil
	}
	if !h.authorize(r, c, level) {
		forbid(w)
		return nil
	}
	return c
}

// respondCluster re-reads the row + live status and writes it at the given code.
func (h *clusterHandler) respondCluster(w http.ResponseWriter, r *http.Request, id string, code int) {
	c, err := h.store.GetCluster(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to load cluster")
		return
	}
	status, _ := h.k8s.Get(r.Context(), c.CRName)
	WriteJSON(w, code, toClusterResponse(*c, status))
}

// start (re)provisions the CR from stored config and marks desired_state Running.
func (h *clusterHandler) start(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "manage")
	if c == nil {
		return
	}
	if _, err := h.k8s.Create(r.Context(), h.buildSpec(c.CRName, loadConfig(c))); err != nil && !k8serrors.IsAlreadyExists(err) {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to start cluster: "+err.Error())
		return
	}
	_, _ = h.store.SetClusterDesiredState(r.Context(), id, "Running")
	_ = h.store.TouchClusterActivity(r.Context(), id)
	h.respondCluster(w, r, id, http.StatusOK)
}

// stop deletes the CR (keeping the row + config) and marks desired_state Stopped.
func (h *clusterHandler) stop(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "manage")
	if c == nil {
		return
	}
	if err := h.k8s.Delete(r.Context(), c.CRName); err != nil && !k8serrors.IsNotFound(err) {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to stop cluster: "+err.Error())
		return
	}
	_, _ = h.store.SetClusterDesiredState(r.Context(), id, "Stopped")
	h.respondCluster(w, r, id, http.StatusOK)
}

// restart deletes then recreates the CR from stored config.
func (h *clusterHandler) restart(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "manage")
	if c == nil {
		return
	}
	if err := h.k8s.Delete(r.Context(), c.CRName); err != nil && !k8serrors.IsNotFound(err) {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to restart (stop phase): "+err.Error())
		return
	}
	if _, err := h.k8s.Create(r.Context(), h.buildSpec(c.CRName, loadConfig(c))); err != nil && !k8serrors.IsAlreadyExists(err) {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to restart (start phase): "+err.Error())
		return
	}
	_, _ = h.store.SetClusterDesiredState(r.Context(), id, "Running")
	_ = h.store.TouchClusterActivity(r.Context(), id)
	h.respondCluster(w, r, id, http.StatusOK)
}

// clone provisions a new cluster (new row + CR) from a source cluster's config.
func (h *clusterHandler) clone(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	src := h.getAuthorizedCluster(w, r, id, "manage")
	if src == nil {
		return
	}
	req := loadConfig(src)
	var body struct {
		Name string `json:"name"`
	}
	_ = json.NewDecoder(r.Body).Decode(&body) // empty body is fine
	newName := strings.TrimSpace(body.Name)
	if newName == "" {
		newName = src.Name + "-clone"
	}
	req.Name = newName

	crName, err := generateCRName(newName)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "internal_error", "failed to generate cluster name")
		return
	}
	if _, err := h.k8s.Create(r.Context(), h.buildSpec(crName, req)); err != nil {
		WriteError(w, http.StatusBadGateway, "provision_error", "failed to clone cluster: "+err.Error())
		return
	}
	configJSON, _ := json.Marshal(req)
	cluster, err := h.store.CreateCluster(r.Context(), store.CreateClusterParams{
		Name:      newName,
		Namespace: h.namespace,
		CRName:    crName,
		Config:    configJSON,
		Owner:     callerName(r),
	})
	if err != nil {
		log.Printf("WARN: clone CR %q created but DB insert failed: %v", crName, err)
		WriteError(w, http.StatusInternalServerError, "store_error", "cluster cloned but metadata save failed")
		return
	}
	WriteJSON(w, http.StatusCreated, toClusterResponse(*cluster, k8s.ClusterStatus{}))
}

// patch updates pin state and/or the persisted config (config takes effect on
// the next start/restart). Body: {"pinned": bool, "config": {<createClusterReq>}}.
func (h *clusterHandler) patch(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	if c := h.getAuthorizedCluster(w, r, id, "manage"); c == nil {
		return
	}
	var body struct {
		Pinned *bool             `json:"pinned"`
		Config *createClusterReq `json:"config"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	if body.Pinned != nil {
		if _, err := h.store.SetClusterPinned(r.Context(), id, *body.Pinned); err != nil {
			WriteError(w, http.StatusInternalServerError, "store_error", "failed to update pin")
			return
		}
	}
	if body.Config != nil {
		cfgJSON, _ := json.Marshal(body.Config)
		if _, err := h.store.UpdateClusterConfig(r.Context(), id, cfgJSON); err != nil {
			WriteError(w, http.StatusInternalServerError, "store_error", "failed to update config")
			return
		}
	}
	h.respondCluster(w, r, id, http.StatusOK)
}

// events returns Kubernetes events for the cluster's CR + pods.
func (h *clusterHandler) events(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "attach")
	if c == nil {
		return
	}
	events, err := h.k8s.Events(r.Context(), c.CRName)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "events_error", "failed to fetch events: "+err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, map[string]any{"events": events})
}

// logs returns recent driver-pod logs as text/plain (the UI tails by polling).
func (h *clusterHandler) logs(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "attach")
	if c == nil {
		return
	}
	logs, err := h.k8s.DriverLogs(r.Context(), c.CRName, 500)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "logs_error", "failed to fetch driver logs: "+err.Error())
		return
	}
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte(logs))
}

// metrics returns best-effort CPU/memory usage (available=false without metrics-server).
func (h *clusterHandler) metrics(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	c := h.getAuthorizedCluster(w, r, id, "attach")
	if c == nil {
		return
	}
	m, err := h.k8s.Metrics(r.Context(), c.CRName)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "metrics_error", "failed to fetch metrics: "+err.Error())
		return
	}
	WriteJSON(w, http.StatusOK, m)
}
