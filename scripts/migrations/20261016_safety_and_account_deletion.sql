-- App Store 1.2 (report + block) and 5.1.1(v) (account deletion) support.

CREATE TABLE IF NOT EXISTS user_blocks (
  id SERIAL PRIMARY KEY,
  blocker_clerk_user_id TEXT NOT NULL,
  blocked_clerk_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_user_blocks_pair ON user_blocks (blocker_clerk_user_id, blocked_clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_user_blocks_blocked ON user_blocks (blocked_clerk_user_id);

CREATE TABLE IF NOT EXISTS content_reports (
  id SERIAL PRIMARY KEY,
  reporter_clerk_user_id TEXT,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_content_reports_status ON content_reports (status, created_at);
