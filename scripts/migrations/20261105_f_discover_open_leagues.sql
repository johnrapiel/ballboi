-- Discover: Open leagues near you (spec: Discover). A league's Discover point
-- is its creator's home area point when it was made. Additive and idempotent.
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_latitude real;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_longitude real;
CREATE INDEX IF NOT EXISTS idx_leagues_open_area ON leagues (area_latitude, area_longitude) WHERE visibility = 'open';
