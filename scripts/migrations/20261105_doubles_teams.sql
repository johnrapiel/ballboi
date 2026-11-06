-- Fixed-partner doubles teams (Wave 2, doubles pairing). One row per team of
-- two league players. Additive only.

CREATE TABLE IF NOT EXISTS league_teams (
  id SERIAL PRIMARY KEY,
  league_id INTEGER NOT NULL,
  player1_id INTEGER NOT NULL,
  player2_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_teams_league_id_leagues_id_fk') THEN
    ALTER TABLE league_teams ADD CONSTRAINT league_teams_league_id_leagues_id_fk
      FOREIGN KEY (league_id) REFERENCES leagues(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_teams_player1_id_players_id_fk') THEN
    ALTER TABLE league_teams ADD CONSTRAINT league_teams_player1_id_players_id_fk
      FOREIGN KEY (player1_id) REFERENCES players(id) ON DELETE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_teams_player2_id_players_id_fk') THEN
    ALTER TABLE league_teams ADD CONSTRAINT league_teams_player2_id_players_id_fk
      FOREIGN KEY (player2_id) REFERENCES players(id) ON DELETE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_league_teams_league_id ON league_teams (league_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_teams_player1 ON league_teams (player1_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_league_teams_player2 ON league_teams (player2_id);
