-- Beta Footage Release agreement (spec decisions 85 and 92): the version a
-- tester agreed to and when. Idempotent.
ALTER TABLE ball_boi_recording_consent ADD COLUMN IF NOT EXISTS release_version integer;
ALTER TABLE ball_boi_recording_consent ADD COLUMN IF NOT EXISTS release_agreed_at timestamptz;
