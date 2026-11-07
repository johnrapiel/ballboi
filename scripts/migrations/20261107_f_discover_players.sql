-- Discover, Players near you (Wave 2, Session F). Additive and idempotent.
--
-- discover_profiles: one row per account placed in Discover. Hidden profile,
--   what they play, the last distance picked, and the approximate point
--   Discover measures from (the home ZIP's center, with its town). The API
--   fills and refreshes rows from users.home_zip as it reads them.
-- weekly_availability: the "When you can play" grid, a generic Monday to
--   Sunday week of hours (slot = day * 24 + hour; Monday is 0). Discover only.
--   The old per-league player_availability table is untouched.

CREATE TABLE IF NOT EXISTS discover_profiles (
  clerk_user_id text PRIMARY KEY,
  hidden boolean NOT NULL DEFAULT false,
  plays text,
  radius_miles integer NOT NULL DEFAULT 10,
  area_zip text,
  area_town text,
  area_state text,
  area_latitude real,
  area_longitude real,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_discover_profiles_area ON discover_profiles (area_latitude, area_longitude);

CREATE TABLE IF NOT EXISTS weekly_availability (
  clerk_user_id text PRIMARY KEY,
  slots integer[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now()
);
