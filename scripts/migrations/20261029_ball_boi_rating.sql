-- Ball Boi Rating (spec: Ball Boi Rating). Additive only.
-- users.rating is the current NTRP-scale rating; rating_history keeps every
-- change for the profile trend line.

ALTER TABLE users ADD COLUMN IF NOT EXISTS rating numeric(4, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_source text;

CREATE TABLE IF NOT EXISTS rating_history (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  rating numeric(4, 2) NOT NULL,
  delta numeric(4, 2) NOT NULL DEFAULT 0,
  reason TEXT NOT NULL,
  match_id INTEGER,
  weight REAL NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rating_history_user ON rating_history (clerk_user_id, created_at);
-- One rating change per player per match, so a score can't move a rating twice.
CREATE UNIQUE INDEX IF NOT EXISTS uq_rating_history_user_match ON rating_history (clerk_user_id, match_id);
