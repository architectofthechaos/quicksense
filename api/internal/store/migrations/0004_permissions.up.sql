-- 4e: object-level permission store (server-side authorization).
CREATE TABLE permissions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  object_type    TEXT NOT NULL,            -- cluster | notebook | table
  object_id      TEXT NOT NULL,
  principal_type TEXT NOT NULL,            -- user | group
  principal_id   TEXT NOT NULL,
  level          TEXT NOT NULL,            -- per object_type ladder (see authz package)
  granted_by     TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (object_type, object_id, principal_type, principal_id)
);
CREATE INDEX permissions_object_idx ON permissions (object_type, object_id);
