ALTER TABLE matches ADD COLUMN IF NOT EXISTS season TEXT;

UPDATE matches SET season = 'Spring Exhibition'
WHERE status = 'completed' AND season IS NULL;
