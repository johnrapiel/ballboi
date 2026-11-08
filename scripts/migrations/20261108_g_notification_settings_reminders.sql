-- Match day reminders (Wave 2, Session G; spec decision 127): the switch in
-- Settings > Notifications, on by default. Additive and idempotent.
ALTER TABLE notification_settings ADD COLUMN IF NOT EXISTS match_reminders boolean NOT NULL DEFAULT true;
