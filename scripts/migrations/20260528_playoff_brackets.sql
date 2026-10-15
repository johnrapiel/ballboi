CREATE TABLE IF NOT EXISTS playoff_brackets (
  id serial PRIMARY KEY,
  league_id integer NOT NULL REFERENCES leagues(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active',
  seedings jsonb NOT NULL DEFAULT '[]',
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE matches ADD COLUMN IF NOT EXISTS playoff_bracket_id integer REFERENCES playoff_brackets(id) ON DELETE SET NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS playoff_round text;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS playoff_slot integer;
