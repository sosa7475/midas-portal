/**
 * Strategy evaluation: backtest a candidate spec (crypto perp OR on-chain) and judge a
 * challenger vs the current champion on out-of-sample data (last 30% held out), with
 * guardrails so an overfit tweak can't auto-promote itself.
 */
import {createHash} from "node:crypto";
import {macroFactors,defiRiskOnSeries} from "./defi";
import { fetchHistory, fetchHistoryOnchain, runBacktest, type Candle } from "./backtest";

async function candlesFor(spec: any): Promise<Candle[]> {
  if (spec.network || spec.address || spec.pool) {
    const r = await fetchHistoryOnchain(spec.network || "eth", { pool: spec.pool, address: spec.address }, spec.interval);
    return r.candles;
  }
  const years = Math.min(Math.max(spec.years || 3, 0.25), 10);
  return fetchHistory(spec.symbol, spec.interval, years,{endTime:spec.endTime});
}

export async function backtestSpec(spec: any, sharedCandles?:Candle[]) {
  let candles: Candle[];
  try { candles = sharedCandles??await candlesFor(spec); } catch (error) { return { ok: false as const, error: error instanceof Error ? error.message : "History fetch failed" }; }
  if (candles.length <= 60) return { ok: false as const, error: `insufficient history (${candles.length} bars)` };
  const usesFactors=JSON.stringify(spec).includes("defi_")||JSON.stringify(spec).includes("stablecoin_");
  const factors=usesFactors?await macroFactors(candles):undefined;
  const riskOn=spec.defiTrendFilter?await defiRiskOnSeries(candles):undefined;
  const initialEquity=spec.initialEquity??10000;
  const full = runBacktest(candles, { ...spec },riskOn,factors,{initialEquity});
  const cut = Math.floor(candles.length * 0.7);
  const oos = cut >= 60 ? runBacktest(candles, { ...spec }, riskOn, factors, { startIndex: cut,initialEquity }) : null;
  const dataHash=createHash("sha256").update(JSON.stringify(candles)).digest("hex");
  return { ok: true as const, bars: candles.length, full, oos, dataHash, candles, evaluatedAt:new Date().toISOString() };
}

const num = (v: any) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Compare challenger vs champion. Prefer OOS metrics; guardrails on Sharpe margin, drawdown, min trades. */
export function judge(champEval: any | null, challEval: any) {
  if (!challEval?.ok || !challEval.oos) return { win: false, basis: "unvalidated", reason: "Held-out evaluation is required; full-history results cannot promote a strategy." };
  const c = challEval.oos;
  const basis = challEval.oos ? "out-of-sample" : "full-history";
  if (c.dataQuality?.eligibleForPromotion !== true) return { win: false, basis: "unvalidated", reason: "Candle quality must be checked and pass: missing intervals or zero-volume bars can invalidate signals and simulated fills, including during warm-up." };
  const cs = num(c?.sharpe) ?? -Infinity, cTrades = c?.trades ?? 0, cDD = num(c?.maxDrawdownPct) ?? 999;
  if (cTrades < 30) return { win: false, basis, reason: `challenger produced only ${cTrades} trades on ${basis} data — too few to trust.` };
  if (!(num(c.totalReturnPct)! > 0) || !(cs > 0) || !(num(c.profitFactor)! > 1)) return { win: false, basis, reason: "Challenger must have positive net return, positive Sharpe and profit factor above 1 on held-out data." };
  const p = champEval ? (champEval.oos ?? champEval.full) : null;
  if (!p) return { win: true, basis, reason: `no prior champion with a runnable spec — adopting as the baseline.` };
  const ps = num(p.sharpe) ?? -Infinity, pDD = num(p.maxDrawdownPct) ?? 0;
  const marginOk = cs > ps + 0.1;
  const ddOk = cDD <= pDD * 1.5 + 2;
  const win = marginOk && ddOk;
  const f = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : "n/a");
  const reason = win
    ? `challenger Sharpe ${f(cs)} beats champion ${f(ps)} on ${basis} data, drawdown ${cDD.toFixed(1)}% within bounds.`
    : !marginOk ? `challenger Sharpe ${f(cs)} did not beat champion ${f(ps)} by margin on ${basis} data.`
    : `challenger drawdown ${cDD.toFixed(1)}% too high vs champion ${pDD.toFixed(1)}%.`;
  return { win, basis, reason };
}

/** Minimal spec validity check before we bother backtesting. */
export function validSpec(spec: any): string | null {
  if (!spec || typeof spec !== "object") return "spec is required (the runnable strategy).";
  if (!spec.symbol && !spec.address && !spec.pool) return "spec needs a symbol (or on-chain address/pool).";
  if (!spec.interval) return "spec needs an interval (15m/1h/4h/1d).";
  if(!["15m","1h","4h","1d"].includes(spec.interval)||!["long","short","both"].includes(spec.direction))return "Unsupported interval or direction";
  const indicators=new Set("close open high low volume ema sma rsi atr roc macd_line macd_signal macd_hist bb_upper bb_mid bb_lower donchian_high donchian_low defi_tvl defi_tvl_roc30 stablecoin_mcap stablecoin_roc30".split(" "));
  for(const key of ["entryLong","entryShort","exitLong","exitShort"]) {
    if(spec[key]!==undefined && !Array.isArray(spec[key]))return "Conditions must be arrays of objects";
    for(const c of spec[key]??[]) {
      if(!c||![">","<",">=","<=","cross_above","cross_below"].includes(c.op))return "Invalid condition";
      for(const o of [c.left,c.right])if(!o||!(Number.isFinite(o.value)||indicators.has(o.ind)) || (o.period!==undefined&&(!Number.isInteger(o.period)||o.period<1||o.period>2000)))return "Invalid operand";
    }
  }
  if (!Number.isFinite(spec.riskPct)||spec.riskPct<=0||spec.riskPct>100) return "spec needs riskPct (e.g. 1).";
  const hasEntry = (spec.entryLong?.length || 0) + (spec.entryShort?.length || 0) > 0;
  if (!hasEntry) return "spec needs at least one entry condition (entryLong or entryShort).";
  return null;
}
