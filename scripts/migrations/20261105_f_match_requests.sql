-- Discover: match requests (spec: Discover, "From found to playing").
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS match_requests (
  id serial PRIMARY KEY,
  from_clerk_user_id text NOT NULL,
  to_clerk_user_id text NOT NULL,
  date text NOT NULL,
  window_start text NOT NULL,
  window_end text NOT NULL,
  time_zone text NOT NULL,
  court_id integer,
  kind text NOT NULL DEFAULT 'singles',
  note text,
  status text NOT NULL DEFAULT 'pending',
  waiting_on_clerk_user_id text NOT NULL,
  counters integer NOT NULL DEFAULT 0,
  match_id integer,
  from_confirmed_at timestamptz,
  to_confirmed_at timestamptz,
  confirm_prompt_sent_at timestamptz,
  reminder_sent_at timestamptz,
  no_show_clerk_user_id text,
  cancelled_by_clerk_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_match_requests_from ON match_requests (from_clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_match_requests_to ON match_requests (to_clerk_user_id);
