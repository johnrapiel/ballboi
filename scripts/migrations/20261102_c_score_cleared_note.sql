-- After an undo (C4 follow-up), the opponent sees "Score cleared by {name}"
-- on the match card until a new score is entered. Additive and idempotent.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_cleared_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS score_cleared_by_name TEXT;
