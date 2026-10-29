-- Direct messages: conversation records for Ball Boi's messaging rules.
-- Message text lives in the messaging provider (Stream Chat). Spec: Messaging and moderation.
-- Idempotent: safe to run more than once.

CREATE TABLE IF NOT EXISTS dm_conversations (
  id SERIAL PRIMARY KEY,
  pair_key TEXT NOT NULL,
  user_a TEXT NOT NULL,
  user_b TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  requester TEXT,
  channel_id TEXT NOT NULL,
  opening_hash TEXT,
  last_message_at TIMESTAMPTZ,
  last_message_text TEXT,
  last_sender TEXT,
  a_unread INTEGER NOT NULL DEFAULT 0,
  b_unread INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  accepted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_dm_conversations_pair ON dm_conversations (pair_key);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_a ON dm_conversations (user_a);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_user_b ON dm_conversations (user_b);
CREATE INDEX IF NOT EXISTS idx_dm_conversations_requester ON dm_conversations (requester, created_at);
