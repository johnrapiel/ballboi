CREATE TABLE IF NOT EXISTS league_rounds (
  id serial PRIMARY KEY,
  league_id integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  round_number integer NOT NULL,
  start_date text NOT NULL,
  end_date text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS round_id integer REFERENCES league_rounds(id) ON DELETE SET NULL;
