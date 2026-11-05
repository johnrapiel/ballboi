-- Discover: the court directory and an optional home court (spec: Discover).
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS directory_courts (
  id serial PRIMARY KEY,
  name text NOT NULL,
  place text,
  zip text NOT NULL,
  latitude real NOT NULL,
  longitude real NOT NULL,
  access text NOT NULL DEFAULT 'public',
  surface text,
  lights boolean,
  court_count integer,
  added_by_clerk_user_id text,
  hidden_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_directory_courts_point ON directory_courts (latitude, longitude);
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_court_id integer;
