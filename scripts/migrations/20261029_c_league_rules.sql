-- League rules from the spec (Leagues; decisions 23 to 29): co-admins, weekly
-- rounds that an admin reviews before they go out, byes and locked pairings,
-- the 1-week grace period, dropouts, and Open-league requests and waitlists.
-- Additive only and idempotent: existing leagues keep working.

-- Co-admins (spec: Roles). The league creator is the owner.
CREATE TABLE IF NOT EXISTS league_admins (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'co_admin',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_admins_member ON league_admins (league_id, clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_league_admins_clerk_user_id ON league_admins (clerk_user_id);

INSERT INTO league_admins (league_id, clerk_user_id, role)
SELECT id, created_by_clerk_user_id, 'owner'
FROM leagues
WHERE created_by_clerk_user_id IS NOT NULL
ON CONFLICT (league_id, clerk_user_id) DO NOTHING;

-- Dropouts (decision 27): the player row stays so played matches keep their names.
ALTER TABLE players ADD COLUMN IF NOT EXISTS left_at TIMESTAMPTZ;

-- Rounds go out when published (decision 29). Rounds created before this
-- migration were already visible to players, so they count as published.
ALTER TABLE league_rounds ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ;
UPDATE league_rounds SET published_at = created_at WHERE published_at IS NULL;

-- A player sitting out a round (odd roster, or an admin's choice).
CREATE TABLE IF NOT EXISTS league_round_byes (
  id SERIAL PRIMARY KEY,
  round_id INTEGER NOT NULL REFERENCES league_rounds(id) ON DELETE CASCADE,
  player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_round_byes_player ON league_round_byes (round_id, player_id);

-- Locked pairings survive a re-pair; voided matches (dropouts) never count;
-- grace-week matches (decision 25) count for ratings and stats, not standings.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS voided_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS in_grace BOOLEAN NOT NULL DEFAULT FALSE;

-- Requests to join an Open league, and the waitlist for next season (decision 26).
CREATE TABLE IF NOT EXISTS league_join_requests (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  player_name TEXT NOT NULL,
  skill_level TEXT NOT NULL DEFAULT '3.0',
  kind TEXT NOT NULL DEFAULT 'request',
  status TEXT NOT NULL DEFAULT 'pending',
  decided_by_clerk_user_id TEXT,
  decided_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_join_requests_pending
  ON league_join_requests (league_id, clerk_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_league_join_requests_league ON league_join_requests (league_id, status);
