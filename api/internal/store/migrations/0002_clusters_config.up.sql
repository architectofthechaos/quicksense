-- 4b: production cluster config + lifecycle state.
-- The full create request (workers, driver/executor resources, image, idle,
-- spark_conf, env, tags) is persisted as one JSONB blob so Start/Restart can
-- re-render the SparkConnect CR from the stored desired config.
ALTER TABLE clusters
  ADD COLUMN config JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN desired_state TEXT NOT NULL DEFAULT 'Running',
  ADD COLUMN last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();
