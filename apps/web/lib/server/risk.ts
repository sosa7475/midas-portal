/**
 * Server-side risk engine — a hard gate that runs before any order reaches
 * Orderly. Enforced in code, not prompt text. Per-agent account equity based.
 */
export interface RiskLimits {
  maxNotionalUsd: number;   // absolute cap on position notional
  maxLeverage: number;      // notional / equity
  maxRiskPerTradePct: number; // % of equity riskable (entry→stop)
}

export const DEFAULT_LIMITS: RiskLimits = {
  maxNotionalUsd: 25_000,
  maxLeverage: 10,
  maxRiskPerTradePct: 2,
};

export interface RiskInput {
  price: number;       // entry / mark
  quantity: number;
  equityUsd: number;
  stopLoss?: number;
}

export interface RiskVerdict { ok: boolean; violations: string[]; notionalUsd: number; leverage: number }

export function checkOrder(i: RiskInput, limits: RiskLimits = DEFAULT_LIMITS): RiskVerdict {
  const invalid = [i.price, i.quantity, i.equityUsd].some(v => !Number.isFinite(v) || v <= 0)
    || (i.stopLoss !== undefined && (!Number.isFinite(i.stopLoss) || i.stopLoss <= 0))
    || Object.values(limits).some(v => !Number.isFinite(v) || v < 0);
  if (invalid) return {ok:false, violations:["Price, quantity, equity and limits must be valid finite values"], notionalUsd:0, leverage:0};
  const notionalUsd = i.price * i.quantity;
  const leverage = i.equityUsd > 0 ? notionalUsd / i.equityUsd : Infinity;
  const violations: string[] = [];

  if (i.equityUsd <= 0) violations.push("Account has no collateral — fund it before trading.");
  if (notionalUsd > limits.maxNotionalUsd) violations.push(`Notional $${notionalUsd.toFixed(0)} exceeds max $${limits.maxNotionalUsd}.`);
  if (leverage > limits.maxLeverage) violations.push(`Leverage ${isFinite(leverage) ? leverage.toFixed(1) : "∞"}x exceeds max ${limits.maxLeverage}x.`);
  if (i.stopLoss && i.equityUsd > 0) {
    const riskPct = (Math.abs(i.price - i.stopLoss) * i.quantity) / i.equityUsd * 100;
    if (riskPct > limits.maxRiskPerTradePct) violations.push(`Trade risks ${riskPct.toFixed(1)}% of equity (max ${limits.maxRiskPerTradePct}%).`);
  }
  return { ok: violations.length === 0, violations, notionalUsd, leverage };
}
