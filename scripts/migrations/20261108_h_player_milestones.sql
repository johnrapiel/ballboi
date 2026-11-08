-- Career milestones (Wave 2, Session H; spec decisions 149 and 150).
-- Earned once per player, stored with the date. Additive and idempotent.
-- Existing players are backfilled by the API on start (lib/milestoneRepo.ts),
-- which only inserts what's missing.
CREATE TABLE IF NOT EXISTS player_milestones (
  id serial PRIMARY KEY,
  clerk_user_id text NOT NULL,
  kind text NOT NULL,
  earned_at timestamptz NOT NULL,
  match_id integer REFERENCES matches(id) ON DELETE SET NULL,
  seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS player_milestones_user_kind_unique ON player_milestones (clerk_user_id, kind);
CREATE INDEX IF NOT EXISTS idx_player_milestones_user ON player_milestones (clerk_user_id);
