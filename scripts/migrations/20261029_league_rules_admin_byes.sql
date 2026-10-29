-- Byes an admin marks stay put when the round is re-paired; automatic byes
-- (the odd player out) are recalculated. Follows 20261029_league_rules.sql.
ALTER TABLE league_round_byes ADD COLUMN IF NOT EXISTS set_by_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- Name the new foreign keys the way Drizzle does, so the schema and the
-- database agree (no spurious changes from drizzle-kit).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_admins_league_id_fkey') THEN
    ALTER TABLE league_admins RENAME CONSTRAINT league_admins_league_id_fkey TO league_admins_league_id_leagues_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_join_requests_league_id_fkey') THEN
    ALTER TABLE league_join_requests RENAME CONSTRAINT league_join_requests_league_id_fkey TO league_join_requests_league_id_leagues_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_round_byes_round_id_fkey') THEN
    ALTER TABLE league_round_byes RENAME CONSTRAINT league_round_byes_round_id_fkey TO league_round_byes_round_id_league_rounds_id_fk;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'league_round_byes_player_id_fkey') THEN
    ALTER TABLE league_round_byes RENAME CONSTRAINT league_round_byes_player_id_fkey TO league_round_byes_player_id_players_id_fk;
  END IF;
END $$;
