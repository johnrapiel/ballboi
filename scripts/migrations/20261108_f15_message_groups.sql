-- Group chats on the messaging service (F15, John, Nov 8). Additive and
-- idempotent. open_match_messages stays in place, no longer written to;
-- dropping it waits for John's go-ahead.
CREATE TABLE IF NOT EXISTS message_groups (
  id serial PRIMARY KEY,
  channel_id text NOT NULL,
  open_match_id integer,
  title text NOT NULL,
  open boolean NOT NULL DEFAULT true,
  closed_reason text,
  last_message_at timestamptz,
  last_message_text text,
  last_sender text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_groups_channel ON message_groups (channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_groups_open_match ON message_groups (open_match_id);

CREATE TABLE IF NOT EXISTS message_group_members (
  id serial PRIMARY KEY,
  group_id integer NOT NULL REFERENCES message_groups(id) ON DELETE CASCADE,
  clerk_user_id text NOT NULL,
  unread integer NOT NULL DEFAULT 0,
  first_sent_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_group_members ON message_group_members (group_id, clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_message_group_members_user ON message_group_members (clerk_user_id);
