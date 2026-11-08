-- Finding 7 (John, Nov 6): either player can edit a league score for 24 hours
-- after it's entered, and the other player sees "Score edited by {name}".
-- Replaces the 10-minute Undo. The name is kept as it was at the time.
-- Additive and idempotent.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_edited_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_edited_by_clerk_user_id TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_edited_by_name TEXT;
