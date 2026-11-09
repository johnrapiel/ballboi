-- DeviceCheck device bans (Wave 2, Session G; acceptance 38).
-- Additive and idempotent.
CREATE TABLE IF NOT EXISTS device_check_tokens (
  id serial PRIMARY KEY,
  clerk_user_id text NOT NULL,
  token text NOT NULL,
  apple_env text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS device_check_tokens_user_unique ON device_check_tokens (clerk_user_id);

CREATE TABLE IF NOT EXISTS device_bans (
  id serial PRIMARY KEY,
  clerk_user_id text NOT NULL,
  kind text NOT NULL,
  sanction_id integer,
  phone_marked text NOT NULL DEFAULT 'no',
  reason text NOT NULL,
  created_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  lifted_at timestamptz,
  lifted_by text
);
CREATE INDEX IF NOT EXISTS idx_device_bans_user ON device_bans (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_device_bans_sanction ON device_bans (sanction_id);
