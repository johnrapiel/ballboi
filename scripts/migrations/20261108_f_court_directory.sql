-- Discover: the court directory and an optional home court (Wave 2,
-- Session F; F4). Additive and idempotent. Dated the 8th so it runs after
-- 20261107_f_discover_players.sql (filename order), which made discover_profiles.
CREATE TABLE IF NOT EXISTS directory_courts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  address text NOT NULL,
  zip text NOT NULL,
  town text,
  latitude real NOT NULL,
  longitude real NOT NULL,
  added_by_clerk_user_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directory_courts_point ON directory_courts (latitude, longitude);

ALTER TABLE discover_profiles ADD COLUMN IF NOT EXISTS home_court_id integer REFERENCES directory_courts(id) ON DELETE SET NULL;
