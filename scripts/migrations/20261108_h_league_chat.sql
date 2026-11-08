-- League chat on the messaging service (Wave 2, decisions 145 and 146).
-- Additive and idempotent: one chat per league, pins, the standings each
-- chat last posted, and per-member admin, mute and button counts. Existing
-- leagues get their chat from the startup job, not from this file.
ALTER TABLE message_groups ADD COLUMN IF NOT EXISTS league_id integer;
ALTER TABLE message_groups ADD COLUMN IF NOT EXISTS pinned_ids jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE message_groups ADD COLUMN IF NOT EXISTS standings jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_groups_league ON message_groups (league_id);

ALTER TABLE message_group_members ADD COLUMN IF NOT EXISTS attention integer NOT NULL DEFAULT 0;
ALTER TABLE message_group_members ADD COLUMN IF NOT EXISTS admin boolean NOT NULL DEFAULT false;
ALTER TABLE message_group_members ADD COLUMN IF NOT EXISTS muted_at timestamptz;
