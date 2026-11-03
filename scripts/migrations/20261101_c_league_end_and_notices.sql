-- Ending and deleting a league (Oct 31 review, C9 and C10; decision 31).
-- ended_at: an admin ended the league; standings freeze and it moves to Past.
-- league_notices: one-line in-app notes for players, such as
-- "{league} was deleted by its organizer". Additive and idempotent.
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS league_notices (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dismissed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_league_notices_clerk_user_id ON league_notices (clerk_user_id);
