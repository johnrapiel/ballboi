-- League setup options from the spec (Leagues > Setup): visibility, eligibility,
-- doubles partner mode, season length, playoffs, and the unplayed-match rule.
-- Additive only; existing leagues keep working with the defaults.

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'private';
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS partner_mode text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS min_rating text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS max_rating text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS roster_cap integer;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS season_weeks integer;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS playoff_size integer NOT NULL DEFAULT 0;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS unplayed_rule text NOT NULL DEFAULT 'no_result';
