-- Doubles partners (Wave 2, doubles flow review D1 to D10, John, Nov 9).
-- Additive and idempotent. Replaces draft PR #115's league_teams migration,
-- which never ran anywhere.
--
-- league_teams: fixed-partner teams. Split or broken teams keep their row
--   (dissolved_at), so played matches still name them.
-- league_partner_requests: "Team up with someone" requests, 48 hours to answer.
-- league_match_chat_cards: at-most-once log for the doubles chat's day-before
--   and "Did it happen?" lines.
-- players.looking_for_partner_at: on the "Find me a partner" list.
-- matches.team1_id, team2_id: the fixed team on each side, for team standings.
-- message_groups.match_id, member_titles: a doubles match's chat for all four
--   players, titled for each of them.

CREATE TABLE IF NOT EXISTS league_teams (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  player1_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  player2_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  made_by TEXT NOT NULL DEFAULT 'request',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  dissolved_at TIMESTAMPTZ,
  dissolved_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams (league_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_player1_id ON league_teams (player1_id);
CREATE INDEX IF NOT EXISTS idx_league_teams_player2_id ON league_teams (player2_id);

CREATE TABLE IF NOT EXISTS league_partner_requests (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  from_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  to_player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at TIMESTAMPTZ,
  notice_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_league_partner_requests_league_id ON league_partner_requests (league_id);
CREATE INDEX IF NOT EXISTS idx_league_partner_requests_status ON league_partner_requests (status);

CREATE TABLE IF NOT EXISTS league_match_chat_cards (
  match_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (match_id, kind)
);

ALTER TABLE players ADD COLUMN IF NOT EXISTS looking_for_partner_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team1_id INTEGER;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS team2_id INTEGER;
ALTER TABLE message_groups ADD COLUMN IF NOT EXISTS match_id INTEGER;
ALTER TABLE message_groups ADD COLUMN IF NOT EXISTS member_titles JSONB;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_groups_match ON message_groups (match_id);
