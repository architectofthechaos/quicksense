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

	"github.com/deepiq/quicksense/api/internal/store"
)

// notebookHandler handles /v1/notebooks routes. Notebook source + revisions live
// in the API's Postgres (control-plane storage); execution (4d-1) is brokered
// separately to Spark Connect and is not part of this handler.
type notebookHandler struct {
	store store.Store
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
	nb, err := h.store.CreateNotebook(r.Context(), store.CreateNotebookParams{
		Name: req.Name, Path: path, FolderID: req.FolderID, Content: req.Content,
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
		// list view omits content for payload size
		n.Content = nil
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
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// update handles PUT /v1/notebooks/{id} (save cell content).
func (h *notebookHandler) update(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		Content json.RawMessage `json:"content"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Content) == 0 {
		WriteError(w, http.StatusBadRequest, "invalid_json", "content is required")
		return
	}
	nb, err := h.store.UpdateNotebookContent(r.Context(), id, req.Content)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "notebook not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to save notebook")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// trash handles DELETE /v1/notebooks/{id} (soft-delete).
func (h *notebookHandler) trash(w http.ResponseWriter, r *http.Request) {
	if err := h.store.TrashNotebook(r.Context(), chi.URLParam(r, "id")); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "notebook not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to trash notebook")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// attach handles POST /v1/notebooks/{id}/attach {cluster_id}.
func (h *notebookHandler) attach(w http.ResponseWriter, r *http.Request) {
	id := chi.URLParam(r, "id")
	var req struct {
		ClusterID string `json:"cluster_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		WriteError(w, http.StatusBadRequest, "invalid_json", "request body must be valid JSON")
		return
	}
	nb, err := h.store.AttachNotebookCluster(r.Context(), id, req.ClusterID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			WriteError(w, http.StatusNotFound, "not_found", "notebook not found")
			return
		}
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to attach cluster")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// listRevisions handles GET /v1/notebooks/{id}/revisions.
func (h *notebookHandler) listRevisions(w http.ResponseWriter, r *http.Request) {
	revs, err := h.store.ListRevisions(r.Context(), chi.URLParam(r, "id"))
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
	nb, err := h.store.UpdateNotebookContent(r.Context(), id, rev.Snapshot)
	if err != nil {
		WriteError(w, http.StatusInternalServerError, "store_error", "failed to restore revision")
		return
	}
	WriteJSON(w, http.StatusOK, toNotebookResponse(*nb))
}

// export handles GET /v1/notebooks/{id}/export?format=ipynb|py.
func (h *notebookHandler) export(w http.ResponseWriter, r *http.Request) {
	nb := h.getOr404(w, r, chi.URLParam(r, "id"))
	if nb == nil {
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
	if h.getOr404(w, r, chi.URLParam(r, "id")) == nil {
		return
	}
	WriteError(w, http.StatusNotImplemented, "execution_unavailable",
		"cell execution requires the Spark Connect broker (not yet configured)")
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
