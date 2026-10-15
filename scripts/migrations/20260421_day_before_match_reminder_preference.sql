ALTER TABLE players ADD COLUMN IF NOT EXISTS day_before_match_reminder_enabled boolean NOT NULL DEFAULT true;
