-- Drop two leftovers nothing reads or writes any more (John approved, Nov 8).
-- open_match_messages: the old open match group chat. Since F15 (#171, #172)
--   group chats run on the messaging service (message_groups).
-- leagues.unplayed_rule: retired by decision 25 (every league has a fixed
--   1-week grace period). The create-league request still accepts the field
--   from older builds and ignores it.
-- Idempotent: safe to run on a database that never had either.
DROP TABLE IF EXISTS open_match_messages;
ALTER TABLE leagues DROP COLUMN IF EXISTS unplayed_rule;
