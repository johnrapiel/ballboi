-- Every shot stored as structured data (spec: Ball Boi > Data foundation for
-- later coaching): who hit it (near or far side), where it landed on the court
-- in meters, the line call, serve details, and how the point ended.
-- Idempotent: safe to run on a database that already has these columns.

ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS hitter_side TEXT;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS landing_x_m REAL;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS landing_y_m REAL;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS landing_seconds REAL;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS line_call TEXT;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS line_call_confidence REAL;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS close_call BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS line_distance_m REAL;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS serve_number INTEGER;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS serve_zone TEXT;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS point_end TEXT;
ALTER TABLE match_shots ADD COLUMN IF NOT EXISTS model_version TEXT;
