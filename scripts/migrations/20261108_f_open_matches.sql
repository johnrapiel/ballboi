-- Discover: Open matches (Wave 2, Session F; F6). Additive and idempotent.
CREATE TABLE IF NOT EXISTS open_matches (
  id serial PRIMARY KEY,
  poster_clerk_user_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_zone text NOT NULL DEFAULT 'America/New_York',
  court_id integer REFERENCES directory_courts(id) ON DELETE SET NULL,
  court_name text,
  format text NOT NULL DEFAULT 'singles',
  spots integer NOT NULL DEFAULT 1,
  min_rating real,
  max_rating real,
  note text,
  status text NOT NULL DEFAULT 'open',
  area_latitude real NOT NULL,
  area_longitude real NOT NULL,
  match_id integer REFERENCES matches(id) ON DELETE SET NULL,
  filled_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_open_matches_area ON open_matches (status, area_latitude, area_longitude);
CREATE INDEX IF NOT EXISTS idx_open_matches_poster ON open_matches (poster_clerk_user_id);

CREATE TABLE IF NOT EXISTS open_match_players (
  id serial PRIMARY KEY,
  open_match_id integer NOT NULL REFERENCES open_matches(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'in',
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  notice_pending boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_match_players ON open_match_players (open_match_id, clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_open_match_players_user ON open_match_players (clerk_user_id);

CREATE TABLE IF NOT EXISTS open_match_messages (
  id serial PRIMARY KEY,
  open_match_id integer NOT NULL REFERENCES open_matches(id) ON DELETE CASCADE,
  sender_clerk_user_id text,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_open_match_messages ON open_match_messages (open_match_id, id);

CREATE TABLE IF NOT EXISTS open_match_alerts (
  id serial PRIMARY KEY,
  clerk_user_id text NOT NULL,
  open_match_id integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_open_match_alerts_user ON open_match_alerts (clerk_user_id, sent_at);

ALTER TABLE discover_profiles ADD COLUMN IF NOT EXISTS match_alerts boolean NOT NULL DEFAULT false;
