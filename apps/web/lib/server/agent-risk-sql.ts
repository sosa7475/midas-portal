import { query } from "./db";

/**
 * Per-agent, user-configurable trading guardrails — enforced server-side on every
 * execution (so they hold even for an autonomous cron and even if the LLM misbehaves).
 * Nothing hardcoded: these are starting values the user edits per agent; any field can be
 * null to mean "no limit". `paused` is the kill switch.
 */
export interface RiskConfig {
  paused: boolean;
  autoExecute: boolean;               // skip the in-app confirm card — execute trades automatically (within limits)
  maxNotionalUsd: number | null;      // per-trade notional cap
  maxLeverage: number | null;         // per-trade leverage cap
  maxRiskPerTradePct: number | null;  // per-trade % of equity at risk (entry→stop)
  maxTradesPerDay: number | null;     // trades in a UTC day
  dailyLossLimitUsd: number | null;   // stop trading once today's realized PnL <= -this (perps)
}

// Starting values shown to the user — fully editable per agent.
export const RISK_DEFAULTS: RiskConfig = {
  paused: false,
  autoExecute: false,
  maxNotionalUsd: 5_000,
  maxLeverage: 1,
  maxRiskPerTradePct: 2,
  maxTradesPerDay: 20,
  dailyLossLimitUsd: null,
};

// Risk storage is provisioned by the control migration, never by concurrent requests.
export async function getRisk(userId: string, agentId: string): Promise<RiskConfig> {
  const r = await query<any>("SELECT config FROM agent_risk WHERE user_id=$1 AND agent_id=$2", [userId, agentId]);
  return { ...RISK_DEFAULTS, ...(r.rows[0]?.config ?? {}) };
}

export async function setRisk(userId: string, agentId: string, patch: Partial<RiskConfig>): Promise<RiskConfig> {
  const cur = await getRisk(userId, agentId);
  const next: RiskConfig = { ...cur, ...patch };
  await query(
    `INSERT INTO agent_risk (user_id, agent_id, config, updated_at) VALUES ($1,$2,$3,NOW())
     ON CONFLICT (user_id, agent_id) DO UPDATE SET config=$3, updated_at=NOW()`,
    [userId, agentId, JSON.stringify(next)]
  );
  return next;
}

/** Count executed trades logged for this agent so far in the current UTC day. */
export async function tradesToday(userId: string, agentId: string): Promise<number> {
  const r = await query<any>(
    "SELECT COUNT(*)::int AS n FROM agent_perf WHERE user_id=$1 AND agent_id=$2 AND kind='trade' AND created_at >= date_trunc('day', now() at time zone 'utc')",
    [userId, agentId]
  );
  return r.rows[0]?.n ?? 0;
}

export interface GuardInput { notionalUsd?: number | null; leverage?: number | null; riskPct?: number | null; realizedPnlTodayUsd?: number | null }

/** The single gate every execution path calls. Returns ok=false with human-readable reasons. */
export async function enforceGuardrails(userId: string, agentId: string, o: GuardInput = {}): Promise<{ ok: boolean; violations: string[]; config: RiskConfig }> {
  const c = await getRisk(userId, agentId);
  const v: string[] = [];
  for (const [limit, measured, label] of [[c.maxNotionalUsd,o.notionalUsd,"Notional"],[c.maxLeverage,o.leverage,"Leverage"],[c.maxRiskPerTradePct,o.riskPct,"Stop risk"],[c.dailyLossLimitUsd,o.realizedPnlTodayUsd,"Daily PnL"]] as const) {
    // Callers check applicable dimensions through checkOrder; PnL must never fail open.
    if (label === "Daily PnL" && limit !== null && (measured == null || !Number.isFinite(measured))) v.push("Daily PnL unavailable; configured loss limit cannot be checked");
  }
  if (c.paused) v.push("Trading is paused for this agent (kill switch is ON).");
  if (c.maxTradesPerDay != null) {
    const n = await tradesToday(userId, agentId);
    if (n >= c.maxTradesPerDay) v.push(`Daily trade limit reached (${n}/${c.maxTradesPerDay}).`);
  }
  if (c.maxNotionalUsd != null && o.notionalUsd != null && o.notionalUsd > c.maxNotionalUsd) v.push(`Notional $${Math.round(o.notionalUsd)} exceeds cap $${c.maxNotionalUsd}.`);
  if (c.maxLeverage != null && o.leverage != null && o.leverage > c.maxLeverage) v.push(`Leverage ${o.leverage.toFixed(1)}x exceeds cap ${c.maxLeverage}x.`);
  if (c.maxRiskPerTradePct != null && o.riskPct != null && o.riskPct > c.maxRiskPerTradePct) v.push(`Risk ${o.riskPct}% exceeds cap ${c.maxRiskPerTradePct}%.`);
  if (c.dailyLossLimitUsd != null && o.realizedPnlTodayUsd != null && o.realizedPnlTodayUsd <= -Math.abs(c.dailyLossLimitUsd)) v.push(`Daily loss limit hit (realized ${o.realizedPnlTodayUsd.toFixed(0)} ≤ -$${c.dailyLossLimitUsd}). Trading halted for today.`);
  return { ok: v.length === 0, violations: v, config: c };
}
