CREATE TABLE IF NOT EXISTS expo_push_tokens (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  last_used TIMESTAMP,
  status TEXT NOT NULL DEFAULT 'active'
);

CREATE INDEX IF NOT EXISTS idx_expo_push_tokens_user_id ON expo_push_tokens(user_id);
