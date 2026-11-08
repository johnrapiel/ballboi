-- Settings › Notifications (Wave 2, Session G; spec decision 128).
-- One row per account, made the first time a switch changes. Additive and idempotent.
CREATE TABLE IF NOT EXISTS notification_settings (
  clerk_user_id text PRIMARY KEY,
  message_previews boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
