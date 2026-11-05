-- Discover, Players near you (Wave 2, Session F). Additive only.
--
-- area_latitude / area_longitude: the approximate point Discover measures
--   from (rounded device point, else the home zip's center). The API fills
--   these for existing accounts on start (lib/discoverArea backfill).
-- discover_hidden: hidden profile, out of Players near you.
-- plays: singles | doubles | both, for the Discover filter. NULL = not said.
-- free_times: weekday_mornings, weekday_evenings, weekends. NULL = not said.

ALTER TABLE users ADD COLUMN IF NOT EXISTS area_latitude real;
ALTER TABLE users ADD COLUMN IF NOT EXISTS area_longitude real;
ALTER TABLE users ADD COLUMN IF NOT EXISTS discover_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS plays text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS free_times text[];

CREATE INDEX IF NOT EXISTS idx_users_area ON users (area_latitude, area_longitude);
