-- Onboarding steps 3 to 6 (spec: Roles and onboarding). Additive only.
-- Home area as a zip, an optional approximate location (two decimals), and the
-- "What brings you here?" answer.

ALTER TABLE users ADD COLUMN IF NOT EXISTS home_zip text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_latitude real;
ALTER TABLE users ADD COLUMN IF NOT EXISTS home_longitude real;
ALTER TABLE users ADD COLUMN IF NOT EXISTS intent text;
