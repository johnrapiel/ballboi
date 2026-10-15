CREATE TABLE IF NOT EXISTS match_reminders_log (
  id serial PRIMARY KEY,
  match_id integer NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  reminder_type text NOT NULL,
  reminder_for_date text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS match_reminders_log_match_type_date_unique
  ON match_reminders_log (match_id, reminder_type, reminder_for_date);