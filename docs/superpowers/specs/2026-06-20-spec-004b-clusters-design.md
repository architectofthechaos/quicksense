# SPEC-004b Design — Production Clusters (K8s-native, unified)

Parent: program design. One form for all deployments — pod resources against an existing K8s cluster. No cloud/on-prem branching.

## Data model (migration 0002)
Extend `clusters`: `worker_min int`, `worker_max int`, `driver_cpu text`, `driver_mem text`, `driver_cpu_limit text`, `driver_mem_limit text`, `executor_cpu text`, `executor_mem text`, `executor_cpu_limit text`, `executor_mem_limit text`, `image text`, `idle_minutes int`, `pinned bool default false`, `spark_conf jsonb`, `env jsonb`, `tags jsonb`, `desired_state text default 'Running'`, `last_activity_at timestamptz`.

## CR builder (`api/internal/k8s/sparkconnect.go`)
Extend `ClusterSpec` + `buildCR` to set: driver/executor `resources.{requests,limits}.{cpu,memory}`, `executor.instances` from worker min (dynamic alloc min/max via sparkConf `spark.dynamicAllocation.{enabled,minExecutors,maxExecutors}`), `image`, merged `sparkConf` (catalog conf + user conf), env vars on both templates, and `tags` as labels. Keep the live-validated full-template form.

## Endpoints (`api/internal/http/clusters.go`)
- `POST /v1/clusters` — accept the full body; validate; persist config; create CR.
- `PATCH /v1/clusters/{id}` — pin/unpin, edit config (re-render CR on next start).
- `POST /v1/clusters/{id}/start` — recreate CR from stored config; `desired_state=Running`.
- `POST /v1/clusters/{id}/stop` — delete CR (keep row+config); `desired_state=Stopped`.
- `POST /v1/clusters/{id}/restart` — stop + start.
- `POST /v1/clusters/{id}/clone` — new row+CR from an existing config (new name).
- `GET /v1/clusters/{id}/events` — translate CR/pod events (k8s `events` for the CR's pods).
- `GET /v1/clusters/{id}/logs?container=driver` — **SSE** stream of driver pod logs (`client-go` `GetLogs` follow).
- `GET /v1/clusters/{id}/metrics` — best-effort from metrics-server (`metrics.k8s.io`); if absent, `{available:false}` (documented stub).

## Idle auto-terminate
A lightweight reconcile goroutine in the API (ticker): for each Running, non-`pinned` cluster whose `last_activity_at` is older than `idle_minutes`, stop it. `last_activity_at` bumped on attach/run (4d) and lifecycle actions. Pin excludes.

## k8s client additions
New methods on the k8s client: `Events(ctx, crName)`, `DriverLogs(ctx, crName) (io.ReadCloser)`, `Metrics(ctx, crName)`. Add a `PodLister`/`corev1` typed client alongside the dynamic client for pods/events/logs.

## UI
- **Clusters page** (full-width `DataTable`): name, status badge, workers, driver/exec resources, age, actions (start/stop/restart/clone/delete/pin via a row menu).
- **Create form** (`ResourceForm`): name; worker min/max; driver + executor cpu/mem request/limit (`ResourceField`); `image` (advanced override); idle minutes; `KeyValueEditor` for spark conf / env / tags.
- **Detail** (right panel, `Tabs`): Overview (phase, namespace, CR name, resources, connect string) · Events · Driver logs (`LogViewer`, live SSE) · Metrics (best-effort) · Permissions (tab shown; functional in 4e).
- `lib/api.ts`: `createCluster(full)`, `patchCluster`, `startCluster`/`stop`/`restart`/`clone`, `clusterEvents`, `clusterLogs` (stream), `clusterMetrics`. Next route handlers for each, including an SSE-passthrough handler for logs.

## Tests
- Go: CR builder (resources/instances/env/labels/conf-merge); each endpoint via `httptest` + fake dynamic client + fake store; lifecycle state transitions; idle reconcile logic (pure function over rows + clock).
- UI: create form validation/serialization; lifecycle action calls; tab rendering; `LogViewer` SSE consumption (mocked stream).

## DoD
Create form supports all fields → CR with those resources → Ready. Start/Stop/Restart/Delete/Clone/Pin work and reflect real CR state. Detail shows Overview + Events + Driver logs (Metrics best-effort). Form identical everywhere. Tests for endpoints + components.
