-- Message reports with snapshots, and auto-restrict. Spec: Messaging and moderation.
-- Additive and idempotent.

ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'user';
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS subject_clerk_user_id TEXT;
CREATE INDEX IF NOT EXISTS idx_content_reports_subject ON content_reports (subject_clerk_user_id);

-- Earlier player reports: fill in the account they're about.
UPDATE content_reports r SET subject_clerk_user_id = p.clerk_user_id
FROM players p
WHERE r.subject_clerk_user_id IS NULL AND r.target_type = 'player'
  AND r.target_id ~ '^[0-9]+$' AND p.id = r.target_id::int;

CREATE TABLE IF NOT EXISTS message_report_snapshots (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
  conversation_id INTEGER,
  messages JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_message_report_snapshots_report ON message_report_snapshots (report_id);

CREATE TABLE IF NOT EXISTS messaging_restrictions (
  id SERIAL PRIMARY KEY,
  clerk_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  source TEXT NOT NULL,
  report_id INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lifted_at TIMESTAMPTZ,
  lifted_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_messaging_restrictions_user ON messaging_restrictions (clerk_user_id, lifted_at);
