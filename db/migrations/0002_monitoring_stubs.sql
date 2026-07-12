-- 0002_monitoring_stubs: tables for Phases 2–3 (positions, fills, alerts,
-- strategy versioning, risk limits). Created now so contracts can reference them;
-- fleshed out / used by later phases.

-- Live positions (maintained by the Orderly WS listener + reconciliation job)
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pair VARCHAR(50) NOT NULL,
  side VARCHAR(10) CHECK (side IN ('long', 'short')),
  size DECIMAL(20, 8) NOT NULL DEFAULT 0,
  entry_price DECIMAL(20, 8),
  mark_price DECIMAL(20, 8),
  unrealized_pnl DECIMAL(20, 8),
  liquidation_price DECIMAL(20, 8),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, pair)
);

-- Order fills (from Orderly WS / reconciliation)
CREATE TABLE IF NOT EXISTS fills (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id UUID REFERENCES trades(id) ON DELETE SET NULL,
  order_id VARCHAR(255) NOT NULL,
  pair VARCHAR(50) NOT NULL,
  side VARCHAR(10),
  price DECIMAL(20, 8) NOT NULL,
  quantity DECIMAL(20, 8) NOT NULL,
  fee DECIMAL(20, 8),
  filled_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(order_id, filled_at, price, quantity)
);

-- Price / fill alerts (push notifications)
CREATE TABLE IF NOT EXISTS alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind VARCHAR(30) NOT NULL CHECK (kind IN ('price', 'fill', 'position', 'risk')),
  pair VARCHAR(50),
  condition_json JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  triggered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Strategy version history (immutable snapshots)
CREATE TABLE IF NOT EXISTS strategy_versions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  strategy_id UUID NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  version INT NOT NULL,
  rules_text TEXT NOT NULL,
  parsed_rules_json JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(strategy_id, version)
);

-- Server-side risk limits (hard gate — client cannot bypass)
CREATE TABLE IF NOT EXISTS risk_limits (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  max_position_size_usd DECIMAL(20, 2),
  max_leverage DECIMAL(6, 2),
  max_daily_loss_usd DECIMAL(20, 2),
  max_risk_per_trade_pct DECIMAL(5, 2),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_positions_user_id ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_fills_user_id ON fills(user_id);
CREATE INDEX IF NOT EXISTS idx_fills_order_id ON fills(order_id);
CREATE INDEX IF NOT EXISTS idx_alerts_user_id ON alerts(user_id);
