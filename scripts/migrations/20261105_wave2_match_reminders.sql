-- Wave 2: Match day reminders, on by default (spec decision 73).
-- One switch per account, in Profile. The older per-league-row flag
-- (players.day_before_match_reminder_enabled) stays and is still honored.
ALTER TABLE users ADD COLUMN IF NOT EXISTS match_reminders_enabled boolean NOT NULL DEFAULT true;
