-- Claude moderation agent decision log. Spec: Enforcement ladder step 3.
-- Additive and idempotent.

CREATE TABLE IF NOT EXISTS moderation_agent_decisions (
  id SERIAL PRIMARY KEY,
  report_id INTEGER NOT NULL REFERENCES content_reports(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  message_id TEXT,
  subject_clerk_user_id TEXT,
  restriction_id INTEGER,
  previous_status TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  undone_at TIMESTAMPTZ,
  reviewed_by TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_moderation_agent_decisions_report ON moderation_agent_decisions (report_id);
CREATE INDEX IF NOT EXISTS idx_moderation_agent_decisions_pending ON moderation_agent_decisions (confirmed_at, undone_at);
