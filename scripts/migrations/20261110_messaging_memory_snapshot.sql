-- Staging messages survive the API sleeping or redeploying (John, Nov 10:
-- "My message history disappeared"). Staging runs the in-memory messaging
-- provider, which kept messages on the container's disk, and that disk is
-- wiped each time the container sleeps (15 idle minutes) or deploys. The
-- provider now saves its messages here as one JSON snapshot when
-- MESSAGING_MEMORY_STORE=database. Production uses Stream and never writes
-- here. Additive and idempotent.
CREATE TABLE IF NOT EXISTS messaging_memory_snapshot (
  key text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
