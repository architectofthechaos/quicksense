// SPDX-License-Identifier: Apache-2.0

package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"k8s.io/apimachinery/pkg/api/errors"
	"k8s.io/apimachinery/pkg/runtime/schema"

	"github.com/deepiq/quicksense/api/internal/auth"
	"github.com/deepiq/quicksense/api/internal/k8s"
	"github.com/deepiq/quicksense/api/internal/polaris"
	"github.com/deepiq/quicksense/api/internal/store"
	"github.com/deepiq/quicksense/api/internal/trino"
)

// ---------------------------------------------------------------------------
// fakeVerifier — always succeeds with a fixed Principal.
// ---------------------------------------------------------------------------

type fakeVerifier struct{}

func (fakeVerifier) Verify(_ context.Context, _ string) (*auth.Principal, error) {
	return &auth.Principal{Username: "qsuser", Roles: []string{"polaris_admin"}}, nil
}

// bearerHeader returns an Authorization header value accepted by fakeVerifier.
const bearerHeader = "Bearer test-token"

// ---------------------------------------------------------------------------
// fakePolaris — records calls and returns canned responses.
// ---------------------------------------------------------------------------

type fakePolaris struct {
	catalogs        []polaris.Catalog
	createdCatalog  polaris.CreateCatalogParams
	tables          []polaris.Table
	namespaces      []polaris.Namespace
	tableMeta       *polaris.TableMetadata
	listedCatalog   string
	listedNamespace string
	createdTable    polaris.CreateTableParams
	createdTCatalog string
	createdTNS      string
}

func (f *fakePolaris) ListCatalogs(_ context.Context) ([]polaris.Catalog, error) {
	return f.catalogs, nil
}

func (f *fakePolaris) CreateCatalog(_ context.Context, p polaris.CreateCatalogParams) (*polaris.Catalog, error) {
	f.createdCatalog = p
	return &polaris.Catalog{Name: p.Name, Type: "INTERNAL"}, nil
}

func (f *fakePolaris) ListTables(_ context.Context, catalog, namespace string) ([]polaris.Table, error) {
	f.listedCatalog = catalog
	f.listedNamespace = namespace
	return f.tables, nil
}

func (f *fakePolaris) CreateTable(_ context.Context, catalog, namespace string, p polaris.CreateTableParams) (*polaris.Table, error) {
	f.createdTCatalog = catalog
	f.createdTNS = namespace
	f.createdTable = p
	return &polaris.Table{Name: p.Name, Namespace: namespace}, nil
}

func (f *fakePolaris) ListNamespaces(_ context.Context, catalog string) ([]polaris.Namespace, error) {
	f.listedCatalog = catalog
	return f.namespaces, nil
}

func (f *fakePolaris) LoadTable(_ context.Context, catalog, namespace, table string) (*polaris.TableMetadata, error) {
	f.listedCatalog = catalog
	f.listedNamespace = namespace
	return f.tableMeta, nil
}

// fakeTrino records the last Sample call and returns a canned result.
type fakeTrino struct {
	result         *trino.Result
	sampledCatalog string
	sampledSchema  string
	sampledTable   string
	limit          int
}

func (f *fakeTrino) Sample(_ context.Context, catalog, schema, table string, limit int) (*trino.Result, error) {
	f.sampledCatalog = catalog
	f.sampledSchema = schema
	f.sampledTable = table
	f.limit = limit
	return f.result, nil
}

// ---------------------------------------------------------------------------
// fakeStore — in-memory store.Store implementation.
// ---------------------------------------------------------------------------

type fakeStore struct {
	mu        sync.Mutex
	clusters  map[string]*store.Cluster
	notebooks map[string]*store.Notebook
	revisions map[string]*store.NotebookRevision
	nextErr   error // if set, the next mutating call returns this error
}

func newFakeStore() *fakeStore {
	return &fakeStore{
		clusters:  make(map[string]*store.Cluster),
		notebooks: make(map[string]*store.Notebook),
		revisions: make(map[string]*store.NotebookRevision),
	}
}

func (f *fakeStore) Ping(_ context.Context) error { return nil }
func (f *fakeStore) Close()                       {}

func (f *fakeStore) CreateWorkspace(_ context.Context, name string) (*store.Workspace, error) {
	return &store.Workspace{ID: "ws-fake", Name: name, CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}

func (f *fakeStore) GetWorkspace(_ context.Context, id string) (*store.Workspace, error) {
	return &store.Workspace{ID: id, Name: "fake", CreatedAt: time.Now(), UpdatedAt: time.Now()}, nil
}

func (f *fakeStore) ListWorkspaces(_ context.Context) ([]store.Workspace, error) {
	return nil, nil
}

func (f *fakeStore) CreateCluster(_ context.Context, p store.CreateClusterParams) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.nextErr != nil {
		err := f.nextErr
		f.nextErr = nil
		return nil, err
	}
	id := fmt.Sprintf("cluster-%d", len(f.clusters)+1)
	c := &store.Cluster{
		ID:             id,
		WorkspaceID:    p.WorkspaceID,
		Name:           p.Name,
		Namespace:      p.Namespace,
		CRName:         p.CRName,
		Phase:          store.ClusterPhasePending,
		Config:         p.Config,
		DesiredState:   "Running",
		LastActivityAt: time.Now(),
		CreatedAt:      time.Now(),
		UpdatedAt:      time.Now(),
	}
	f.clusters[id] = c
	return c, nil
}

func (f *fakeStore) GetCluster(_ context.Context, id string) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *c
	return &cp, nil
}

func (f *fakeStore) ListClusters(_ context.Context) ([]store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	result := make([]store.Cluster, 0, len(f.clusters))
	for _, c := range f.clusters {
		result = append(result, *c)
	}
	return result, nil
}

func (f *fakeStore) UpdateClusterPhase(_ context.Context, id string, phase store.ClusterPhase, connectURL string) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	c.Phase = phase
	c.ConnectURL = connectURL
	cp := *c
	return &cp, nil
}

func (f *fakeStore) DeleteCluster(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.clusters[id]; !ok {
		return store.ErrNotFound
	}
	delete(f.clusters, id)
	return nil
}

func (f *fakeStore) UpdateClusterConfig(_ context.Context, id string, config json.RawMessage) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	c.Config = config
	cp := *c
	return &cp, nil
}

func (f *fakeStore) SetClusterDesiredState(_ context.Context, id, desiredState string) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	c.DesiredState = desiredState
	cp := *c
	return &cp, nil
}

func (f *fakeStore) SetClusterPinned(_ context.Context, id string, pinned bool) (*store.Cluster, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	c.Pinned = pinned
	cp := *c
	return &cp, nil
}

func (f *fakeStore) TouchClusterActivity(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.clusters[id]
	if !ok {
		return store.ErrNotFound
	}
	c.LastActivityAt = time.Now()
	return nil
}

// ---- notebook fakes (4d) ----

func (f *fakeStore) CreateNotebook(_ context.Context, p store.CreateNotebookParams) (*store.Notebook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	content := p.Content
	if len(content) == 0 {
		content = json.RawMessage(`{"cells":[]}`)
	}
	id := fmt.Sprintf("nb-%d", len(f.notebooks)+1)
	n := &store.Notebook{
		ID: id, FolderID: p.FolderID, Name: p.Name, Path: p.Path, Owner: p.Owner,
		Content: content, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	f.notebooks[id] = n
	cp := *n
	return &cp, nil
}

func (f *fakeStore) GetNotebook(_ context.Context, id string) (*store.Notebook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.notebooks[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *n
	return &cp, nil
}

func (f *fakeStore) ListNotebooks(_ context.Context) ([]store.Notebook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.Notebook, 0, len(f.notebooks))
	for _, n := range f.notebooks {
		if n.TrashedAt == nil {
			out = append(out, *n)
		}
	}
	return out, nil
}

func (f *fakeStore) UpdateNotebookContent(_ context.Context, id string, content json.RawMessage) (*store.Notebook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.notebooks[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	n.Content = content
	cp := *n
	return &cp, nil
}

func (f *fakeStore) AttachNotebookCluster(_ context.Context, id, clusterID string) (*store.Notebook, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.notebooks[id]
	if !ok {
		return nil, store.ErrNotFound
	}
	n.AttachedClusterID = clusterID
	cp := *n
	return &cp, nil
}

func (f *fakeStore) TrashNotebook(_ context.Context, id string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	n, ok := f.notebooks[id]
	if !ok {
		return store.ErrNotFound
	}
	now := time.Now()
	n.TrashedAt = &now
	return nil
}

func (f *fakeStore) CreateRevision(_ context.Context, notebookID string, snapshot json.RawMessage, message, author string) (*store.NotebookRevision, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	id := fmt.Sprintf("rev-%d", len(f.revisions)+1)
	r := &store.NotebookRevision{
		ID: id, NotebookID: notebookID, Snapshot: snapshot, Message: message, Author: author, CreatedAt: time.Now(),
	}
	f.revisions[id] = r
	cp := *r
	return &cp, nil
}

func (f *fakeStore) ListRevisions(_ context.Context, notebookID string) ([]store.NotebookRevision, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]store.NotebookRevision, 0)
	for _, r := range f.revisions {
		if r.NotebookID == notebookID {
			out = append(out, *r)
		}
	}
	return out, nil
}

func (f *fakeStore) GetRevision(_ context.Context, revID string) (*store.NotebookRevision, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	r, ok := f.revisions[revID]
	if !ok {
		return nil, store.ErrNotFound
	}
	cp := *r
	return &cp, nil
}

// seed adds a cluster directly to the fake store (for test setup).
func (f *fakeStore) seed(c *store.Cluster) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.clusters[c.ID] = c
}

// count returns the number of clusters in the store.
func (f *fakeStore) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.clusters)
}

// ---------------------------------------------------------------------------
// fakeK8s — records Create/Get/Delete calls; configurable behavior.
// ---------------------------------------------------------------------------

type fakeK8s struct {
	mu          sync.Mutex
	createCalls []k8s.ClusterSpec
	getCalls    []string
	deleteCalls []string

	createErr    error            // returned by Create when set
	getStatus    k8s.ClusterStatus // returned by Get when not in notFoundNames
	notFoundNames map[string]bool  // Get returns k8s NotFound for these names

	events []k8s.Event // returned by Events
	logs   string      // returned by DriverLogs
}

func newFakeK8s() *fakeK8s {
	return &fakeK8s{notFoundNames: make(map[string]bool)}
}

func (f *fakeK8s) Create(_ context.Context, s k8s.ClusterSpec) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.createErr != nil {
		return "", f.createErr
	}
	f.createCalls = append(f.createCalls, s)
	return s.Name, nil
}

func (f *fakeK8s) Get(_ context.Context, name string) (k8s.ClusterStatus, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.getCalls = append(f.getCalls, name)
	if f.notFoundNames[name] {
		return k8s.ClusterStatus{}, errors.NewNotFound(schema.GroupResource{
			Group:    "sparkoperator.k8s.io",
			Resource: "sparkconnects",
		}, name)
	}
	status := f.getStatus
	if status.Name == "" {
		status.Name = name
	}
	return status, nil
}

func (f *fakeK8s) Delete(_ context.Context, name string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.deleteCalls = append(f.deleteCalls, name)
	return nil
}

func (f *fakeK8s) Events(_ context.Context, _ string) ([]k8s.Event, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.events, nil
}

func (f *fakeK8s) DriverLogs(_ context.Context, _ string, _ int64) (string, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.logs, nil
}

func (f *fakeK8s) Metrics(_ context.Context, _ string) (k8s.Metrics, error) {
	return k8s.Metrics{Available: false}, nil
}

func (f *fakeK8s) createCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.createCalls)
}

func (f *fakeK8s) deleteCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.deleteCalls)
}

// ---------------------------------------------------------------------------
// newTestMux — builds a router with all fakes wired.
// ---------------------------------------------------------------------------

func newTestMux(fp *fakePolaris) http.Handler {
	return NewRouter(RouterDeps{
		Verifier: fakeVerifier{},
		Polaris:  fp,
	})
}

func newTestMuxWithClusters(fp *fakePolaris, fs *fakeStore, fk k8s.SparkConnectClient) http.Handler {
	return NewRouter(RouterDeps{
		Verifier:    fakeVerifier{},
		Polaris:     fp,
		Store:       fs,
		K8s:         fk,
		Namespace:   "quicksense",
		DefaultExec: 2,
		SparkImage:  "spark:4.0.3",
	})
}
