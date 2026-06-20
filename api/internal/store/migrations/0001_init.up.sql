CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE workspaces (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE clusters (id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL, name TEXT NOT NULL,
  namespace TEXT NOT NULL, cr_name TEXT NOT NULL UNIQUE, phase TEXT NOT NULL DEFAULT 'Pending',
  connect_url TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE UNIQUE INDEX clusters_ws_name_uniq ON clusters (workspace_id, name);
