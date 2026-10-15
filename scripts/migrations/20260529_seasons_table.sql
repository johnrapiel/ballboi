CREATE TABLE IF NOT EXISTS seasons (
  id SERIAL PRIMARY KEY,
  league_id INTEGER REFERENCES leagues(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the known seasons (global, no league)
INSERT INTO seasons (league_id, name, start_date, end_date)
SELECT NULL, 'Spring Exhibition', '2026-01-01', '2026-05-31'
WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE name = 'Spring Exhibition' AND league_id IS NULL);

INSERT INTO seasons (league_id, name, start_date, end_date)
SELECT NULL, 'Summer League', '2026-06-01', '2026-08-24'
WHERE NOT EXISTS (SELECT 1 FROM seasons WHERE name = 'Summer League' AND league_id IS NULL);
