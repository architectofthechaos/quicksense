# SPEC-004d Design — Notebooks (full depth)

Parent: program design. Largest phase — split **4d-1** (tree + editor + execute + output) and **4d-2** (save/versions/share/export).

## Storage (migration 0003)
- `folders(id, parent_id nullable, name, path unique, trashed_at nullable, created_at)`.
- `notebooks(id, folder_id nullable, name, path, owner, content jsonb, attached_cluster_id nullable, trashed_at nullable, created_at, updated_at)`. `content` = `{cells:[{id, type:'code'|'markdown', source, outputs:[]}]}`.
- `notebook_revisions(id, notebook_id, snapshot jsonb, message, author, created_at)`.
Source persists in the API Postgres — survives cluster restart (DoD §7).

## Execution path (D5 — Python Spark-Connect broker)
- **Broker:** small Python service (FastAPI) in the Spark image (`pyspark[connect]` present). Endpoint `POST /run` `{connect_url, code, session_key}` → opens/reuses a `SparkSession.builder.remote(connect_url)`, executes, streams stdout + result frames + tracebacks as **NDJSON/SSE**. Sessions keyed by `(user, notebook, cluster)`.
- **Go API** `POST /v1/notebooks/{id}/run` (cell or all): resolves the attached cluster's `sc://…` endpoint, calls the broker, relays the stream to the UI as **SSE**. Bumps cluster `last_activity_at` (4b idle). Per-user identity wired in 4e.
- Output framing: `{type:'stdout'|'result'|'error', ...}`; `result` carries `{columns, rows}` for DataFrames; `error` carries `{ename, evalue, traceback}`.

## Endpoints
- `GET /v1/notebooks/tree` — folder/notebook tree (excludes trashed).
- `GET/POST /v1/notebooks`, `GET/PUT/DELETE /v1/notebooks/{id}` — CRUD (PUT saves cells).
- Folder + move/rename/trash ops; `POST /v1/notebooks/{id}/attach` `{cluster_id}`.
- `POST /v1/notebooks/{id}/run` — execute (SSE). Body selects cell(s).
- `GET/POST /v1/notebooks/{id}/revisions`, `POST …/revisions/{rev}/restore` (4d-2).
- `GET /v1/notebooks/{id}/export?format=ipynb|py` (4d-2).

## UI (`ui/app/app/notebooks`) — Notebooks graduates from "Coming soon" in the nav
- **4d-1:** workspace `FileTree` (folders, create, rename, move, trash); `NotebookEditor` with `Cell`s (CodeMirror 6 for code, markdown render/edit toggle); add/delete/reorder cells; `ClusterAttachPicker` (running interactive clusters from 4b); Run cell / Run all; `OutputRenderer` (text / table / error traceback) consuming the SSE stream; busy/queued/running cell states.
- **4d-2:** Save + `RevisionHistory` panel (timestamp/author/message, restore); `ShareDialog` (principal + level — ties to 4e); Export menu (.ipynb / .py).
- `lib/api.ts`: notebook tree/CRUD, attach, run (stream), revisions, export; Next route handlers incl. SSE passthrough for `run`.

## Tests
- Go: notebook CRUD + tree + move/trash; revision save/restore; export (.ipynb/.py serialization); run handler relaying a mocked broker stream.
- Broker: unit test the output framing over a fake/local Spark session (or a stubbed session) — integration-gated.
- UI: cell add/edit/reorder; markdown render; run-cell output rendering (mocked SSE: stdout, table, error); attach picker; revision restore; export.

## DoD
Create a notebook in a tree; add Python + markdown cells; attach to a running cluster; **run a cell that reads/writes `quicksense.demo.events` and see results inline**; Run all renders table/text/error; Save + view history + restore; Share at a chosen level; Export .ipynb and .py; source persists across cluster restart; tests across API + UI.
