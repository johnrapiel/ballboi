-- Quick match invite links for placeholder opponents who aren't on Ball Boi.
-- Idempotent: safe to run on a database that already has this table.

CREATE TABLE IF NOT EXISTS match_invites (
  code TEXT PRIMARY KEY,
  match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  placeholder_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_by_clerk_user_id TEXT NOT NULL,
  claimed_by_clerk_user_id TEXT,
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_match_invites_placeholder ON match_invites (placeholder_player_id);
CREATE INDEX IF NOT EXISTS idx_match_invites_created_by ON match_invites (created_by_clerk_user_id);
