-- 4d: notebooks workspace (control-plane storage; source + revisions in Postgres).
CREATE TABLE folders (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id  UUID REFERENCES folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  path       TEXT NOT NULL UNIQUE,
  trashed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notebooks (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  folder_id           UUID REFERENCES folders(id) ON DELETE SET NULL,
  name                TEXT NOT NULL,
  path                TEXT NOT NULL UNIQUE,
  owner               TEXT NOT NULL DEFAULT '',
  content             JSONB NOT NULL DEFAULT '{"cells":[]}'::jsonb,
  attached_cluster_id UUID,
  trashed_at          TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE notebook_revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notebook_id UUID NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  snapshot    JSONB NOT NULL,
  message     TEXT NOT NULL DEFAULT '',
  author      TEXT NOT NULL DEFAULT '',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notebook_revisions_notebook_idx ON notebook_revisions (notebook_id, created_at DESC);
