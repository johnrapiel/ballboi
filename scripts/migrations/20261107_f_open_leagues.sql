-- Discover, Open leagues (Wave 2, Session F): an optional note to the
-- organizer with "Request a spot". Additive and idempotent.
ALTER TABLE league_join_requests ADD COLUMN IF NOT EXISTS note text;
