-- Ball Boi is disabled on doubles matches; count who saw that, as a demand
-- signal for doubles analysis. One row per person per doubles match.
-- Idempotent: safe to run on a database that already has this table.

CREATE TABLE IF NOT EXISTS ball_boi_doubles_views (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  match_id INTEGER REFERENCES matches(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_ball_boi_doubles_views_user_match ON ball_boi_doubles_views (clerk_user_id, match_id);
