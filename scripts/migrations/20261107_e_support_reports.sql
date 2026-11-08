-- "Something not working?" reports (spec decision 86, B3). Idempotent.
CREATE TABLE IF NOT EXISTS support_reports (
  id serial PRIMARY KEY,
  clerk_user_id text,
  problem text NOT NULL,
  note text,
  source text NOT NULL,
  match_id integer REFERENCES matches(id) ON DELETE SET NULL,
  app_version text,
  device_model text,
  os_version text,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS support_reports_user_created_idx ON support_reports (clerk_user_id, created_at);
