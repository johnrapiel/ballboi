-- League match times and time zones (PR 4: League match times and Record from Home).
--
-- time_zone: the league runs on its creator's time zone (IANA name). Existing
-- leagues keep running on Eastern time, as they do today.
-- match_day / match_time: an admin's weekly match day (0 Sunday to 6 Saturday)
-- and time ("HH:MM", 24-hour, in the league's time zone). Null for leagues
-- where players pick their own time each week.
--
-- Additive and idempotent: safe to run more than once.

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS time_zone text NOT NULL DEFAULT 'America/New_York';
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS match_day integer;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS match_time text;
