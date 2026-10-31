-- Bans, suspensions and one appeal each. Spec: Enforcement ladder steps 4 to 6.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS account_sanctions (
  id SERIAL PRIMARY KEY,
  kind TEXT NOT NULL,
  clerk_user_id TEXT NOT NULL,
  apple_user_id TEXT,
  emails JSONB NOT NULL DEFAULT '[]'::jsonb,
  reason TEXT NOT NULL,
  report_id INTEGER,
  ends_at TIMESTAMPTZ,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at TIMESTAMPTZ,
  lifted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_account_sanctions_user ON account_sanctions (clerk_user_id, lifted_at);
CREATE INDEX IF NOT EXISTS idx_account_sanctions_apple ON account_sanctions (apple_user_id);

CREATE TABLE IF NOT EXISTS sanction_appeals (
  id SERIAL PRIMARY KEY,
  sanction_id INTEGER NOT NULL REFERENCES account_sanctions(id) ON DELETE CASCADE,
  clerk_user_id TEXT NOT NULL,
  report_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  outcome TEXT,
  note TEXT,
  decided_at TIMESTAMPTZ,
  decided_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_sanction_appeals_sanction ON sanction_appeals (sanction_id);
