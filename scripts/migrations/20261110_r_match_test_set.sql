-- Ball Boi test set (shot tracker test plan, decisions T1, T2, T6). John
-- flags a beta match for the frozen test set from the admin beta-footage
-- route; while the beta release is required, its recordings keep their
-- audio until launch instead of 30 days. Additive and idempotent.
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ball_boi_test_set_at timestamptz;
