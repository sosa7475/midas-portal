-- 0003_rate_limits: durable, multi-machine rate limiting via Postgres
-- (replaces the Redis/Upstash store). Keyed by prefix + user-or-IP; rows are
-- reused across windows via upsert so the table stays small.

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_window_start ON rate_limits(window_start);
