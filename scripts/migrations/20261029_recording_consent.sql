-- First-recording consent and the training toggle (on by default), one row
-- per person. Idempotent: safe to run on a database that already has it.

CREATE TABLE IF NOT EXISTS ball_boi_recording_consent (
  clerk_user_id TEXT PRIMARY KEY,
  consented_at TIMESTAMPTZ,
  training_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
