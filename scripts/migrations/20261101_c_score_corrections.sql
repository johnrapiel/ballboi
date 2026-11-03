-- League score corrections (Oct 31 review, C5): an admin can correct a
-- completed match's score from Manage; the match shows who corrected it and
-- when. Additive and idempotent.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS corrected_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS corrected_by_clerk_user_id TEXT;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS corrected_by_name TEXT;
