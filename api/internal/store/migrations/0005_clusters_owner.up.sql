-- 4e: cluster ownership so the creating principal implicitly gets `manage`
-- (mirrors notebooks.owner; enables owner-based object-level authorization).
ALTER TABLE clusters ADD COLUMN owner TEXT NOT NULL DEFAULT '';
