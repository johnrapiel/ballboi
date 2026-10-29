-- Ball Boi Rating (spec: Ball Boi Rating). Additive only.
-- A player's level for matching, on the NTRP scale. Set by the onboarding quiz
-- (Self-rated) or a UTR link (Verified). Results don't move it.

ALTER TABLE users ADD COLUMN IF NOT EXISTS rating numeric(4, 2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS rating_source text;
