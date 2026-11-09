-- Live Activity on both phones (Wave 2, Session G; acceptance 31 to 35).
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS live_sessions (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  recorder_clerk_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  props jsonb NOT NULL,
  pending_command text,
  command_by_clerk_user_id text,
  command_at timestamptz,
  started_for text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_live_sessions_match ON live_sessions (match_id);
CREATE INDEX IF NOT EXISTS idx_live_sessions_recorder ON live_sessions (recorder_clerk_user_id);

CREATE TABLE IF NOT EXISTS live_activity_tokens (
  id serial PRIMARY KEY,
  clerk_user_id text NOT NULL,
  kind text NOT NULL,
  token text NOT NULL,
  activity_id text,
  session_id integer REFERENCES live_sessions(id) ON DELETE CASCADE,
  apns_env text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS live_activity_tokens_token_unique ON live_activity_tokens (token);
CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_user ON live_activity_tokens (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_session ON live_activity_tokens (session_id);
