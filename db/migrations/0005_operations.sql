CREATE TABLE IF NOT EXISTS auth_sessions (
 id UUID PRIMARY KEY, user_id UUID NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
ALTER TABLE oauth_grants ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["read","research","propose"]';
ALTER TABLE oauth_grants ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS mcp_tokens (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), token_hash TEXT NOT NULL UNIQUE,
 user_id UUID NOT NULL,agent_id UUID NOT NULL,label TEXT,created_at TIMESTAMPTZ DEFAULT NOW(),last_used_at TIMESTAMPTZ,expires_at TIMESTAMPTZ
);
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT '["read","research","propose"]';
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS family_id UUID;
CREATE TABLE IF NOT EXISTS worker_health (
 name TEXT PRIMARY KEY, heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), details JSONB NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS operational_alerts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL,agent_id UUID NOT NULL,
 dedupe_key TEXT NOT NULL, severity TEXT NOT NULL, message TEXT NOT NULL, details JSONB NOT NULL DEFAULT '{}',
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),acknowledged_at TIMESTAMPTZ,
 UNIQUE(user_id,agent_id,dedupe_key)
);
CREATE TABLE IF NOT EXISTS spot_exit_rules (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),user_id UUID NOT NULL,agent_id UUID NOT NULL,
 chain TEXT NOT NULL CHECK(chain IN ('base','robinhood')), account TEXT NOT NULL, token_in TEXT NOT NULL,token_out TEXT NOT NULL,
 amount_raw NUMERIC(78,0) NOT NULL CHECK(amount_raw>0),decimals_in INTEGER NOT NULL,decimals_out INTEGER NOT NULL,
 stop_out_raw NUMERIC(78,0) NOT NULL CHECK(stop_out_raw>0), target_out_raw NUMERIC(78,0),
 slippage_pct NUMERIC NOT NULL CHECK(slippage_pct BETWEEN 0 AND 3),gas_reserve_eth TEXT NOT NULL,max_gas_eth TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,status TEXT NOT NULL DEFAULT 'armed',order_id UUID REFERENCES execution_orders(id),
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_error TEXT,
 CHECK(target_out_raw IS NULL OR target_out_raw>stop_out_raw)
);
CREATE UNIQUE INDEX IF NOT EXISTS spot_one_rule_per_asset ON spot_exit_rules(chain,account,token_in) WHERE status IN ('armed','triggered','executing','review_required');
CREATE TABLE IF NOT EXISTS trade_accounting (
 order_id UUID PRIMARY KEY REFERENCES execution_orders(id),user_id UUID NOT NULL,agent_id UUID NOT NULL,
 chain TEXT NOT NULL,account TEXT NOT NULL, token_in TEXT NOT NULL,token_out TEXT NOT NULL,
 input_raw NUMERIC(78,0) NOT NULL, output_raw NUMERIC(78,0) NOT NULL,
 decimals_in INTEGER NOT NULL, decimals_out INTEGER NOT NULL,fee_wei NUMERIC(78,0),
 block_number BIGINT NOT NULL,block_hash TEXT NOT NULL,observed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE agent_runs ADD COLUMN IF NOT EXISTS heartbeat_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1;
ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS delivered_revision BIGINT NOT NULL DEFAULT 0;
ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS delivery_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS delivery_after TIMESTAMPTZ NOT NULL DEFAULT NOW();
ALTER TABLE operational_alerts ADD COLUMN IF NOT EXISTS delivery_lease_until TIMESTAMPTZ;
ALTER TABLE spot_exit_rules ADD COLUMN IF NOT EXISTS entry_order_id UUID UNIQUE REFERENCES execution_orders(id);
ALTER TABLE spot_exit_rules ADD COLUMN IF NOT EXISTS exit_at TIMESTAMPTZ;

-- Unconfirmed EVM receipts and anomalous fills must keep the wallet reservation.
DROP INDEX IF EXISTS execution_one_inflight_account;
CREATE UNIQUE INDEX execution_one_inflight_account ON execution_orders(account_key)
 WHERE status IN ('submitting','unknown') OR (kind='swap' AND status IN ('submitted','review_required'));
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
