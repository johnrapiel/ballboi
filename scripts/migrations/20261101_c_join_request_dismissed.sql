-- Decision 30: a declined request shows the player a one-line note on the
-- Leagues tab until they dismiss it. Additive and idempotent.
ALTER TABLE league_join_requests ADD COLUMN IF NOT EXISTS player_dismissed_at TIMESTAMPTZ;
