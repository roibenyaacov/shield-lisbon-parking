-- Migration 014: Track fixed-spot releases per day
--
-- spot_releases previously represented a whole-week release, but the UI
-- and /api/release operate on individual dates. Without a per-day marker,
-- a fixed-spot owner can release next week's spot before allocation runs
-- and the Friday allocation will silently give the spot back to them.

ALTER TABLE spot_releases
  ADD COLUMN IF NOT EXISTS date DATE;

UPDATE spot_releases
SET date = week_start
WHERE date IS NULL;

ALTER TABLE spot_releases
  ALTER COLUMN date SET NOT NULL;

ALTER TABLE spot_releases
  DROP CONSTRAINT IF EXISTS spot_releases_user_id_week_start_key;

ALTER TABLE spot_releases
  ADD CONSTRAINT spot_releases_user_spot_date_key UNIQUE (user_id, spot_id, date);

CREATE INDEX IF NOT EXISTS idx_spot_releases_date
  ON spot_releases(date);
