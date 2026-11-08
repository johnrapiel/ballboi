-- Opponent notice and "Was that you?" (Wave 2, Session G; spec decision 124).
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS opponent_notices (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS opponent_notices_match_user_unique ON opponent_notices (match_id, clerk_user_id);

CREATE TABLE IF NOT EXISTS opponent_requests (
  code text PRIMARY KEY REFERENCES match_invites(code) ON DELETE CASCADE,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  recorder_clerk_user_id text NOT NULL,
  opponent_clerk_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  notified_at timestamptz,
  answered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_opponent_requests_match ON opponent_requests (match_id);
CREATE INDEX IF NOT EXISTS idx_opponent_requests_opponent ON opponent_requests (opponent_clerk_user_id);
