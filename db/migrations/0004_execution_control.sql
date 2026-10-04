-- Apply before enabling the hardened execution routes or workers.
CREATE TABLE IF NOT EXISTS execution_orders (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, agent_id UUID NOT NULL,
 request_key TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('trade','swap','cancel','close','protection')),
 account_key TEXT NOT NULL, payload JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'proposed',
 approval TEXT, approved_at TIMESTAMPTZ, expires_at TIMESTAMPTZ NOT NULL,
 result JSONB, error TEXT, transactions JSONB NOT NULL DEFAULT '[]',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(user_id,agent_id,request_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS execution_one_inflight_account ON execution_orders(account_key)
 WHERE status IN ('submitting','unknown');
CREATE INDEX IF NOT EXISTS execution_owner ON execution_orders(user_id,agent_id,created_at DESC);
CREATE TABLE IF NOT EXISTS trading_mandates (
 user_id UUID NOT NULL, agent_id UUID NOT NULL, config JSONB NOT NULL,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,agent_id)
);
CREATE TABLE IF NOT EXISTS oauth_grants (
 token_hash TEXT PRIMARY KEY, kind TEXT NOT NULL, user_id UUID NOT NULL, agent_id UUID NOT NULL,
 client_id TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL, consumed_at TIMESTAMPTZ,
 family_id UUID NOT NULL DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS agent_runs (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL, agent_id UUID NOT NULL,
 status TEXT NOT NULL DEFAULT 'running', started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 finished_at TIMESTAMPTZ, result JSONB, error TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS agent_one_run ON agent_runs(user_id,agent_id) WHERE status='running';
CREATE TABLE IF NOT EXISTS agent_schedules (
 user_id UUID NOT NULL, agent_id UUID NOT NULL, enabled BOOLEAN NOT NULL DEFAULT FALSE,
 interval_seconds INTEGER NOT NULL DEFAULT 1800 CHECK(interval_seconds BETWEEN 60 AND 86400),
 next_run_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(user_id,agent_id)
);
CREATE TABLE IF NOT EXISTS execution_events (
 id BIGSERIAL PRIMARY KEY, order_id UUID NOT NULL REFERENCES execution_orders(id),
 kind TEXT NOT NULL, data JSONB NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS signer_nonces (
 signer TEXT PRIMARY KEY, nonce BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS hl_connections_v2 (
 user_id UUID NOT NULL, agent_id UUID NOT NULL, owner_address TEXT NOT NULL,
 signer_address TEXT NOT NULL, secret_enc TEXT NOT NULL, network TEXT NOT NULL,
 disabled BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 PRIMARY KEY(user_id,agent_id)
);
