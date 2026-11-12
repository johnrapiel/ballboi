-- A league's area (finding 19, decision 182): the town or ZIP it plays around.
-- Discover uses it to show an Open league to nearby players and to work out
-- distance. Resolved like a player's home area: a US ZIP's town, state and
-- center. Leagues made before this have no area; Discover falls back to the
-- organizer's home area for them, as it did before.
--
-- Additive and idempotent: safe to run more than once. Every column is nullable.

ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_zip text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_town text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_state text;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_latitude real;
ALTER TABLE leagues ADD COLUMN IF NOT EXISTS area_longitude real;
