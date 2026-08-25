/**
 * Server-side risk engine — a hard gate the agent/client cannot bypass.
 * Enforces the "emotional discipline" promise in code, not prompt text.
 */
export interface RiskLimits {
  maxPositionSizeUsd: number;
  maxLeverage: number;
  maxDailyLossUsd: number;
  maxRiskPerTradePct: number; // % of equity riskable per trade
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxPositionSizeUsd: 5000,
  maxLeverage: 10,
  maxDailyLossUsd: 500,
  maxRiskPerTradePct: 2,
};

export interface ProposedTrade {
  notionalUsd: number; // quantity * price
  leverage: number;
  entry: number;
  stopLoss?: number;
  quantity: number;
}

export interface RiskContext {
  equityUsd: number;
  realizedPnlTodayUsd: number; // negative = loss
}

export interface RiskVerdict {
  ok: boolean;
  violations: string[];
}

export function checkTrade(
  trade: ProposedTrade,
  ctx: RiskContext,
  limits: RiskLimits = DEFAULT_LIMITS
): RiskVerdict {
  const violations: string[] = [];

  if (trade.notionalUsd > limits.maxPositionSizeUsd) {
    violations.push(
      `Position notional $${trade.notionalUsd.toFixed(0)} exceeds max $${limits.maxPositionSizeUsd}`
    );
  }
  if (trade.leverage > limits.maxLeverage) {
    violations.push(`Leverage ${trade.leverage}x exceeds max ${limits.maxLeverage}x`);
  }
  if (ctx.realizedPnlTodayUsd <= -limits.maxDailyLossUsd) {
    violations.push(
      `Daily loss limit hit ($${Math.abs(ctx.realizedPnlTodayUsd).toFixed(0)} ≥ $${limits.maxDailyLossUsd}) — trading halted for today`
    );
  }
  if (trade.stopLoss) {
    const riskUsd = Math.abs(trade.entry - trade.stopLoss) * trade.quantity;
    const riskPct = ctx.equityUsd > 0 ? (riskUsd / ctx.equityUsd) * 100 : Infinity;
    if (riskPct > limits.maxRiskPerTradePct) {
      violations.push(
        `Trade risks ${riskPct.toFixed(1)}% of equity (max ${limits.maxRiskPerTradePct}%). Tighten the stop or cut size.`
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

/** ATR-based position size: quantity such that (entry→stop) risk = riskPct of equity. */
export function sizeFromRisk(params: {
  equityUsd: number;
  riskPct: number;
  entry: number;
  stopLoss: number;
}): number {
  const riskUsd = params.equityUsd * (params.riskPct / 100);
  const perUnit = Math.abs(params.entry - params.stopLoss);
  if (perUnit <= 0) return 0;
  return riskUsd / perUnit;
}
