ALTER TABLE clusters
  DROP COLUMN IF EXISTS config,
  DROP COLUMN IF EXISTS pinned,
  DROP COLUMN IF EXISTS desired_state,
  DROP COLUMN IF EXISTS last_activity_at;
