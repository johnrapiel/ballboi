-- Discover: setting up a match in chat (Wave 2, Session F; F2, F12, F13).
-- Additive and idempotent. Dated the 8th so it runs after the court directory.
CREATE TABLE IF NOT EXISTS match_plans (
  id serial PRIMARY KEY,
  pair_key text NOT NULL,
  proposer_clerk_user_id text NOT NULL,
  recipient_clerk_user_id text NOT NULL,
  starts_at timestamptz NOT NULL,
  time_zone text NOT NULL DEFAULT 'America/New_York',
  court_id integer REFERENCES directory_courts(id) ON DELETE SET NULL,
  court_name text,
  kind text NOT NULL DEFAULT 'singles',
  status text NOT NULL DEFAULT 'proposed',
  match_id integer REFERENCES matches(id) ON DELETE SET NULL,
  responded_at timestamptz,
  ended_at timestamptz,
  ended_by_clerk_user_id text,
  proposer_still_on_at timestamptz,
  recipient_still_on_at timestamptz,
  day_before_sent_at timestamptz,
  reminder_sent_at timestamptz,
  did_it_happen_sent_at timestamptz,
  no_show_reporter_clerk_user_id text,
  no_show_clerk_user_id text,
  no_show_reported_at timestamptz,
  no_show_status text,
  no_show_answered_at timestamptz,
  no_show_expiry_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_plans_pair ON match_plans (pair_key, created_at);
CREATE INDEX IF NOT EXISTS idx_match_plans_starts ON match_plans (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_match_plans_no_show ON match_plans (no_show_clerk_user_id);
