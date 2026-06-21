// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/authz"
	"github.com/deepiq/quicksense/api/internal/broker"
	"github.com/deepiq/quicksense/api/internal/store"
)

// notebookAdminRole is the realm role granting implicit manage on all notebooks.
const notebookAdminRole = "quicksense_admin"

func containsStr(ss []string, target string) bool {
	for _, s := range ss {
		if s == target {
			return true
		}
	}
	return false
}

// notebookHandler handles /v1/notebooks routes. Notebook source + revisions live
// in the API's Postgres (control-plane storage); execution (4d-1) is brokered
// separately to Spark Connect and is not part of this handler.
type notebookHandler struct {
	store store.Store
	brk   broker.Client // 4d-1: Spark Connect execution broker (nil ⇒ /run is 501)
}

// nbCell / nbContent model the persisted cell content for export.
type nbCell struct {
	Type   string `json:"type"` // "code" | "markdown"
	Source string `json:"source"`
}
type nbContent struct {
	Cells []nbCell `json:"cells"`
}

type notebookResponse struct {
	ID                string          `json:"id"`
	FolderID          string          `json:"folder_id,omitempty"`
	Name              string          `json:"name"`
	Path              string          `json:"path"`
	Owner             string          `json:"owner,omitempty"`
	Content           json.RawMessage `json:"content"`
	AttachedClusterID string          `json:"attached_cluster_id,omitempty"`
	CreatedAt         time.Time       `json:"created_at"`
	UpdatedAt         time.Time       `json:"updated_at"`
}

func toNotebookResponse(n store.Notebook) notebookResponse {
	return notebookResponse{
		ID: n.ID, FolderID: n.FolderID, Name: n.Name, Path: n.Path, Owner: n.Owner,
		Content: n.Content, AttachedClusterID: n.AttachedClusterID,
		CreatedAt: n.CreatedAt, UpdatedAt: n.UpdatedAt,
	}
}

type revisionResponse struct {
	ID        string    `json:"id"`
	Message   string    `json:"message"`
	Author    string    `json:"author"`
	CreatedAt time.Time `json:"created_at"`
}

func (h *notebookHandler) getOr404(w http.ResponseWriter, r *http.Request, id string) *store.Notebook {
	nb, err := h.store.GetNotebook(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "notebook not found")
		} else {
			WriteError(w, http.StatusInternalServerError, "store_error", "failed to get notebook")
		}
		return nil
	}
	return nb
}

// authorize reports whether the caller may perform an action requiring `level`
// on the notebook. Owner ⇒ manage; quicksense_admin ⇒ manage; else the
// effective level from direct/group grants must meet `level`. Enforced
// server-side — the UI only reflects this.
func (h *notebookHandler) authorize(r *http.Request, nb *store.Notebook, level string) bool {
	p, ok := auth.PrincipalFromContext(r.Context())
	if !ok {
		return false
	}
	perms, _ := h.store.ListPermissions(r.Context(), "notebook", nb.ID)
	grants := make([]authz.Grant, 0, len(perms))
	for _, g := range perms {
		grants = append(grants, authz.Grant{
			ObjectType: g.ObjectType, ObjectID: g.ObjectID,
			PrincipalType: g.PrincipalType, PrincipalID: g.PrincipalID, Level: g.Level,
		})
	}
	ap := authz.Principal{Username: p.Username, Groups: p.Groups, Admin: containsStr(p.Roles, notebookAdminRole)}
	return authz.Allows("notebook", nb.ID, grants, ap, nb.Owner, level)
}

func forbid(w http.ResponseWriter) {
	WriteError(w, http.StatusForbidden, "forbidden", "you do not have permission for this action")
}

// create handles POST /v1/notebooks.
func (h *notebookHandler) create(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Name     string          `json:"name"`
		Path     string          `json:"path"`
		FolderID string          `json:"folder_id"`
		Content  json.RawMessage `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		WriteError(w, http.StatusBadRequest, "missing_name", "name is required")
		return
	}
	path := req.Path
	if strings.TrimSpace(path) == "" {
		path = "/" + req.Name
	}
	owner := ""
	if p, ok := auth.PrincipalFromContext(r.Context()); ok {
		owner = p.Username
	}
	nb, err := h.store.CreateNotebook(r.Context(), store.CreateNotebookParams{
		Name: req.Name, Path: path, FolderID: req.FolderID, Owner: owner, Content: req.Content,
	})
	if err != nil {
		if errors.Is(err, store.ErrConflict) {
			WriteError(w, http.StatusConflict, "conflict", "a notebook already exists at that path")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to create notebook")
		return
	}
	WriteJSON(w, http.StatusCreated, toNotebookResponse(*nb))
}

// list handles GET /v1/notebooks (the workspace tree, flat by path).
func (h *notebookHandler) list(w http.ResponseWriter, r *http.Request) {
	nbs, err := h.store.ListNotebooks(r.Context())
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to list notebooks")
		return
	}
	out := make([]notebookResponse, 0, len(nbs))
	for _, n := range nbs {
		n := n // capture for &n
		if !h.authorize(r, &n, "view") {
			continue // server-side scoping: only notebooks the caller may view
		}
		n.Content = nil // list view omits content for payload size
		out = append(out, toNotebookResponse(n))
	}
	WriteJSON(w, http.StatusOK, map[string]any{"notebooks": out})
}

// get handles GET /v1/notebooks/{id}.
func (h *notebookHandler) get(w http.ResponseWriter, r *http.Request) {
	nb := h.getOr404(w, r, chi.URLParam(r, "id"))
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "view") {
		forbid(w)
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// update handles PUT /v1/notebooks/{id} (save cell content).
func (h *notebookHandler) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing := h.getOr404(w, r, id)
	if existing == nil {
		return
	}
	if !h.authorize(r, existing, "edit") {
		forbid(w)
		return
	}
	var req struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Content) == 0 {
		WriteError(w, http.StatusBadRequest, "invalid_json", "content is required")
		return
	}
	nb, err := h.store.UpdateNotebookContent(r.Context(), id, req.Content)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to save notebook")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// trash handles DELETE /v1/notebooks/{id} (soft-delete).
func (h *notebookHandler) trash(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	nb := h.getOr404(w, r, id)
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "manage") {
		forbid(w)
		return
	}
	if err := h.store.TrashNotebook(r.Context(), id); err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to trash notebook")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// attach handles POST /v1/notebooks/{id}/attach {cluster_id}.
func (h *notebookHandler) attach(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	existing := h.getOr404(w, r, id)
	if existing == nil {
		return
	}
	if !h.authorize(r, existing, "edit") {
		forbid(w)
		return
	}
	var req struct {
		ClusterID string `json:"cluster_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	nb, err := h.store.AttachNotebookCluster(r.Context(), id, req.ClusterID)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to attach cluster")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// listRevisions handles GET /v1/notebooks/{id}/revisions.
func (h *notebookHandler) listRevisions(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	nb := h.getOr404(w, r, id)
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "view") {
		forbid(w)
		return
	}
	revs, err := h.store.ListRevisions(r.Context(), id)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to list revisions")
		return
	}
	out := make([]revisionResponse, 0, len(revs))
	for _, rev := range revs {
		out = append(out, revisionResponse{ID: rev.ID, Message: rev.Message, Author: rev.Author, CreatedAt: rev.CreatedAt})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"revisions": out})
}

// saveRevision handles POST /v1/notebooks/{id}/revisions — snapshots the current
// content as a new revision.
func (h *notebookHandler) saveRevision(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	nb := h.getOr404(w, r, id)
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "edit") {
		forbid(w)
		return
	}
	var req struct {
		Message string `json:"message"`
	}
	_ = json.NewDecoder(r.Body).Decode(&req) // message optional
	rev, err := h.store.CreateRevision(r.Context(), id, nb.Content, req.Message, nb.Owner)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to save revision")
		return
	}
	WriteJSON(w, http.StatusCreated, revisionResponse{ID: rev.ID, Message: rev.Message, Author: rev.Author, CreatedAt: rev.CreatedAt})
}

// restoreRevision handles POST /v1/notebooks/{id}/revisions/{rev}/restore.
func (h *notebookHandler) restoreRevision(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	nb := h.getOr404(w, r, id)
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "edit") {
		forbid(w)
		return
	}
	revID := chi.URLParam(r, "rev")
	rev, err := h.store.GetRevision(r.Context(), revID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "revision not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to load revision")
		return
	}
	updated, err := h.store.UpdateNotebookContent(r.Context(), id, rev.Snapshot)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to restore revision")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*updated))
}

// export handles GET /v1/notebooks/{id}/export?format=ipynb|py.
func (h *notebookHandler) export(w http.ResponseWriter, r *http.Request) {
	nb := h.getOr404(w, r, chi.URLParam(r, "id"))
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "view") {
		forbid(w)
		return
	}
	var content nbContent
	_ = json.Unmarshal(nb.Content, &content)

	format := r.URL.Query().Get("format")
	switch format {
	case "py":
		w.Header().Set("Content-Type", "text/x-python; charset=utf-8")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, nb.Name+".py"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(exportPy(content)))
	case "ipynb", "":
		w.Header().Set("Content-Type", "application/x-ipynb+json")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename=%q`, nb.Name+".ipynb"))
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(exportIpynb(content))
	default:
		WriteError(w, http.StatusBadRequest, "bad_format", "format must be 'ipynb' or 'py'")
	}
}

// run handles POST /v1/notebooks/{id}/run — cell execution over Spark Connect.
// The Python execution broker (pyspark[connect]) is the deferred 4d-1 spike; until
// it is wired this returns 501 so the UI surfaces a clear "execution unavailable"
// state rather than a hard error.
func (h *notebookHandler) run(w http.ResponseWriter, r *http.Request) {
	nb := h.getOr404(w, r, chi.URLParam(r, "id"))
	if nb == nil {
		return
	}
	if !h.authorize(r, nb, "run") {
		forbid(w)
		return
	}
	if h.brk == nil {
		WriteError(w, http.StatusNotImplemented, "execution_unavailable",
			"cell execution requires the Spark Connect broker (not configured)")
		return
	}
	var req struct {
		Code string `json:"code"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || strings.TrimSpace(req.Code) == "" {
		WriteError(w, http.StatusBadRequest, "bad_request", "code is required")
		return
	}
	if nb.AttachedClusterID == "" {
		WriteError(w, http.StatusBadRequest, "no_cluster", "attach an interactive cluster first")
		return
	}
	cluster, err := h.store.GetCluster(r.Context(), nb.AttachedClusterID)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "cluster_error", "attached cluster is unavailable")
		return
	}
	// The operator names the Spark Connect gRPC service "<cr>-server" on 15002.
	connectURL := "sc://" + cluster.CRName + "-server:15002"
	res, err := h.brk.Run(r.Context(), connectURL, req.Code)
	if err != nil {
		WriteError(w, http.StatusBadGateway, "execution_error", err.Error())
		return
	}
	_ = h.store.TouchClusterActivity(r.Context(), nb.AttachedClusterID) // keeps it off idle-terminate
	outputs := make([]map[string]string, 0, 2)
	if res.Stdout != "" {
		outputs = append(outputs, map[string]string{"type": "stdout", "text": res.Stdout})
	}
	if res.Error != "" {
		outputs = append(outputs, map[string]string{"type": "error", "text": res.Error})
	}
	WriteJSON(w, http.StatusOK, map[string]any{"outputs": outputs})
}

// exportPy renders cells as a Jupytext-style .py with "# %%" cell markers.
func exportPy(c nbContent) string {
	var b strings.Builder
	for _, cell := range c.Cells {
		if cell.Type == "markdown" {
			b.WriteString("# %% [markdown]\n")
			for _, line := range strings.Split(cell.Source, "\n") {
				b.WriteString("# " + line + "\n")
			}
		} else {
			b.WriteString("# %%\n")
			b.WriteString(cell.Source)
			if !strings.HasSuffix(cell.Source, "\n") {
				b.WriteString("\n")
			}
		}
		b.WriteString("\n")
	}
	return b.String()
}

// exportIpynb renders cells as a minimal nbformat v4 notebook.
func exportIpynb(c nbContent) []byte {
	type ipynbCell struct {
		CellType       string   `json:"cell_type"`
		Source         []string `json:"source"`
		Metadata       struct{} `json:"metadata"`
		Outputs        []any    `json:"outputs,omitempty"`
		ExecutionCount *int     `json:"execution_count,omitempty"`
	}
	cells := make([]ipynbCell, 0, len(c.Cells))
	for _, cell := range c.Cells {
		ic := ipynbCell{CellType: "code", Source: []string{cell.Source}}
		if cell.Type == "markdown" {
			ic.CellType = "markdown"
		} else {
			ic.Outputs = []any{}
		}
		cells = append(cells, ic)
	}
	doc := map[string]any{
		"cells":          cells,
		"metadata":       map[string]any{"language_info": map[string]any{"name": "python"}},
		"nbformat":       4,
		"nbformat_minor": 5,
	}
	out, _ := json.MarshalIndent(doc, "", " ")
	return out
}
