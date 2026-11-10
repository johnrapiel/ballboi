-- One Live Activity per match per phone (Nov 9 fix). Each phone's
-- push-to-start token now comes with the app install it belongs to, so a
-- phone that has handed Ball Boi more than one token over time gets one
-- Live Activity, not one per token. Additive and idempotent.
ALTER TABLE live_activity_tokens ADD COLUMN IF NOT EXISTS install_id text;
CREATE INDEX IF NOT EXISTS idx_live_activity_tokens_install ON live_activity_tokens (clerk_user_id, install_id);
