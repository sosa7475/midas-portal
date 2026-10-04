/**
 * Robust, deterministic strategy backtester over multi-year history.
 * Declarative condition DSL — agents express their ACTUAL strategy as entry/exit
 * conditions over a rich indicator library (no arbitrary code, fully reproducible).
 * High-fidelity: fees + slippage, ATR/%/trailing stops, R targets, no lookahead.
 * Data from OKX public candles (Binance/Bybit are US-geo-blocked).
 */
import { gtPools, gtOhlcv } from "./geckoterminal";

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }

// ---- operands + conditions ----
export type IndName =
  | "close" | "open" | "high" | "low" | "volume"
  | "ema" | "sma" | "rsi" | "atr" | "roc"
  | "macd_line" | "macd_signal" | "macd_hist"
  | "bb_upper" | "bb_mid" | "bb_lower"
  | "donchian_high" | "donchian_low"
  | "defi_tvl" | "defi_tvl_roc30" | "stablecoin_mcap" | "stablecoin_roc30"; // DeFiLlama macro factors
export interface Operand { ind?: IndName; period?: number; mult?: number; value?: number }
export type Op = ">" | "<" | ">=" | "<=" | "cross_above" | "cross_below";
export interface Condition { left: Operand; op: Op; right: Operand }

export interface StrategySpec {
  symbol: string;
  interval: "15m" | "1h" | "4h" | "1d";
  years: number;
  direction: "long" | "short" | "both";
  entryLong?: Condition[];
  entryShort?: Condition[];
  exitLong?: Condition[];
  exitShort?: Condition[];
  stopLossAtr?: number;      // stop = ATR(14) * mult
  stopLossPct?: number;      // or fixed % stop
  takeProfitR?: number;      // target = risk * R
  takeProfitPct?: number;
  trailAtr?: number;         // trailing stop = ATR(14) * mult
  riskPct: number;
  feeBps?: number;
  slippageBps?: number;
  fixedCostUsdPerFill?: number; // constant USD network-cost assumption, charged on entry and exit
  defiTrendFilter?: boolean;
  maxHoldingBars?: number; // optional intraday time exit
  maxLeverage?: number; // notional/equity cap, default 1
}

const BARS_PER_YEAR: Record<string, number> = { "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 };
const OKX_BAR: Record<string, string> = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

export function okxInst(input: string): string {
  const s = input.trim().toUpperCase().replace(/^PERP_/, "");
  const base = s.replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
  return `${base}-USDT`;
}

/**
 * On-chain history from GeckoTerminal — backtest ANY token by contract on any chain
 * (base, solana, robinhood/Hood Chain…). Resolves the token's top pool if only an
 * address is given. History depth is whatever GeckoTerminal provides (recent candles).
 */
export async function fetchHistoryOnchain(network: string, ref: { pool?: string; address?: string }, interval: string, limit = 300): Promise<{ candles: Candle[]; pool: string }> {
  let pool = ref.pool;
  if (!pool && ref.address) {
    const pools = await gtPools(network, ref.address);
    pool = pools[0]?.poolAddress;
    if (!pool) throw new Error(`No DEX pool found for ${ref.address} on ${network}`);
  }
  if (!pool) throw new Error("Provide a token contract (address) or a pool for an on-chain backtest.");
  return { candles: await gtOhlcv(network, pool, interval, limit), pool };
}

export interface HistoryOptions {
  endTime?: number; // exclusive UTC timestamp; freezes a reproducible research window
  onProgress?: (pages: number, bars: number) => void;
}

export async function fetchHistory(symbol: string, interval: string, years: number, options: HistoryOptions = {}): Promise<Candle[]> {
  const inst = okxInst(symbol);
  const bar = OKX_BAR[interval];
  if (!bar || !Number.isFinite(years) || years <= 0 || years > 10) throw new Error("Invalid interval or years (must be > 0 and <= 10)");
  const endTime = options.endTime ?? Date.now();
  if (!Number.isFinite(endTime) || endTime <= 0 || endTime > Date.now()) throw new Error("Invalid history endTime");
  const minTime = endTime - years * 365 * 864e5;
  const step = 365 * 864e5 / BARS_PER_YEAR[interval];
  const pageSize = 300; // documented maximum for OKX history-candles
  const maxPages = Math.ceil(years * BARS_PER_YEAR[interval] / pageSize) + 3;
  const out: Candle[] = [];
  let after = String(endTime);
  for (let req = 0; req < maxPages; req++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${encodeURIComponent(inst)}&bar=${bar}&limit=${pageSize}&after=${after}`;
    let rows: string[][] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
        if (!r.ok) throw new Error(`OKX ${r.status} for ${inst}`);
        const j = (await r.json()) as { code?: string; msg?: string; data?: string[][] };
        if (j.code && j.code !== "0") throw new Error(`OKX ${j.code}: ${j.msg ?? "history request failed"}`);
        if (!Array.isArray(j.data)) throw new Error("Malformed OKX history response");
        rows = j.data;
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      }
    }
    if (!rows.length) break;
    for (const k of rows.filter((k) => k[8] === "1")) {
      const c = { time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
      if (Object.values(c).some((n) => !Number.isFinite(n)) || c.low <= 0 || c.volume < 0 || c.low > Math.min(c.open, c.close) || c.high < Math.max(c.open, c.close) || c.high < c.low) throw new Error("Invalid OHLCV candle");
      out.push(c);
    }
    const next = Math.min(...rows.map((k) => +k[0]));
    if (!Number.isFinite(next) || next >= +after) throw new Error("History pagination did not advance");
    after = String(next);
    options.onProgress?.(req + 1, out.length);
    if (next <= minTime || rows.length < pageSize) break;
  }
  out.sort((a, b) => a.time - b.time);
  const unique = [...new Map(out.map((c) => [c.time, c])).values()].filter((c) => c.time >= minTime && c.time + step <= endTime);
  if (!unique.length || unique[0].time > minTime + step * 2 || unique[unique.length - 1].time + step < endTime - step * 2) throw new Error(`Incomplete history for ${inst}: requested ${years} years but fetched ${unique.length} bars.`);
  if (unique.some((c, i) => i > 0 && c.time - unique[i - 1].time !== step)) throw new Error("History contains gaps");
  return unique;
}

// ---- indicator series ----
type Series = (number | null)[];
function sma(v: number[], p: number): Series { const o: Series = []; let s = 0; for (let i = 0; i < v.length; i++) { s += v[i]; if (i >= p) s -= v[i - p]; o.push(i >= p - 1 ? s / p : null); } return o; }
function ema(v: number[], p: number): Series { const o: Series = []; const k = 2 / (p + 1); let prev: number | null = null; for (let i = 0; i < v.length; i++) { if (i < p - 1) { o.push(null); continue; } if (prev === null) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += v[j]; prev = s / p; } else prev = v[i] * k + prev * (1 - k); o.push(prev); } return o; }
function rsi(c: number[], p = 14): Series { const o: Series = new Array(c.length).fill(null); if (c.length <= p) return o; let g = 0, l = 0; for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; } let ag = g / p, al = l / p; o[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; o[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al); } return o; }
function atr(c: Candle[], p = 14): Series { const o: Series = new Array(c.length).fill(null); if (c.length <= p) return o; const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close))); let prev = tr.slice(1, p + 1).reduce((a, b) => a + b, 0) / p; o[p] = prev; for (let i = p + 1; i < c.length; i++) { prev = (prev * (p - 1) + tr[i]) / p; o[i] = prev; } return o; }
function roc(c: number[], p: number): Series { return c.map((v, i) => i >= p && c[i - p] ? (v / c[i - p] - 1) * 100 : null); }
function macd(c: number[]) { const f = ema(c, 12), s = ema(c, 26); const line = c.map((_, i) => f[i] != null && s[i] != null ? f[i]! - s[i]! : null); const sig = ema(line.map((x) => x ?? 0), 9); const hist = c.map((_, i) => line[i] != null ? line[i]! - (sig[i] ?? 0) : null); return { line, signal: sig, hist }; }
function boll(c: number[], p = 20, m = 2) { const mid = sma(c, p); const up: Series = [], lo: Series = []; for (let i = 0; i < c.length; i++) { if (i < p - 1 || mid[i] == null) { up.push(null); lo.push(null); continue; } let v = 0; for (let j = i - p + 1; j <= i; j++) v += (c[j] - mid[i]!) ** 2; const sd = Math.sqrt(v / p); up.push(mid[i]! + m * sd); lo.push(mid[i]! - m * sd); } return { mid, up, lo }; }
function donchian(c: Candle[], p: number) { const hi: Series = [], lo: Series = []; for (let i = 0; i < c.length; i++) { if (i < p) { hi.push(null); lo.push(null); continue; } let h = -Infinity, l = Infinity; for (let j = i - p; j < i; j++) { h = Math.max(h, c[j].high); l = Math.min(l, c[j].low); } hi.push(h); lo.push(l); } return { hi, lo }; }

/** Resolve an operand to a value series, computing (and caching) the needed indicator. */
function resolver(candles: Candle[], factors?: Record<string, Series>) {
  const c = candles.map((x) => x.close);
  const cache = new Map<string, Series>();
  const m = macd(c);
  const get = (op: Operand): Series => {
    if (op.value != null) return candles.map(() => op.value!);
    const ind = op.ind ?? "close";
    if (factors && factors[ind]) return factors[ind]; // external DeFi macro factors
    const key = `${ind}:${op.period ?? ""}:${op.mult ?? ""}`;
    if (cache.has(key)) return cache.get(key)!;
    let s: Series;
    switch (ind) {
      case "close": s = c; break;
      case "open": s = candles.map((x) => x.open); break;
      case "high": s = candles.map((x) => x.high); break;
      case "low": s = candles.map((x) => x.low); break;
      case "volume": s = candles.map((x) => x.volume); break;
      case "ema": s = ema(c, op.period ?? 20); break;
      case "sma": s = sma(c, op.period ?? 20); break;
      case "rsi": s = rsi(c, op.period ?? 14); break;
      case "atr": s = atr(candles, op.period ?? 14); break;
      case "roc": s = roc(c, op.period ?? 10); break;
      case "macd_line": s = m.line; break;
      case "macd_signal": s = m.signal; break;
      case "macd_hist": s = m.hist; break;
      case "bb_upper": s = boll(c, op.period ?? 20, op.mult ?? 2).up; break;
      case "bb_mid": s = boll(c, op.period ?? 20, op.mult ?? 2).mid; break;
      case "bb_lower": s = boll(c, op.period ?? 20, op.mult ?? 2).lo; break;
      case "donchian_high": s = donchian(candles, op.period ?? 20).hi; break;
      case "donchian_low": s = donchian(candles, op.period ?? 20).lo; break;
      default: throw new Error(`Unsupported or unavailable indicator: ${ind}`);
    }
    cache.set(key, s);
    return s;
  };
  return { get };
}

function evalConds(conds: Condition[] | undefined, res: ReturnType<typeof resolver>, i: number): boolean {
  if (!conds || !conds.length) return false;
  for (const cnd of conds) {
    const L = res.get(cnd.left), R = res.get(cnd.right);
    const l = L[i], r = R[i], lp = L[i - 1], rp = R[i - 1];
    if (l == null || r == null) return false;
    let ok = false;
    switch (cnd.op) {
      case ">": ok = l > r; break;
      case "<": ok = l < r; break;
      case ">=": ok = l >= r; break;
      case "<=": ok = l <= r; break;
      case "cross_above": ok = lp != null && rp != null && lp <= rp && l > r; break;
      case "cross_below": ok = lp != null && rp != null && lp >= rp && l < r; break;
    }
    if (!ok) return false; // all conditions AND
  }
  return true;
}

export interface BacktestTrade {
  entryTime: number; exitTime: number; side: "long" | "short";
  entryPrice: number; exitPrice: number; units: number; fees: number; netPnl: number; rMultiple: number;
  exitReason: "signal" | "time" | "stop" | "target" | "end";
}
export interface BacktestOptions {
  startIndex?: number; // indicator history retained, trading starts here
  endIndex?: number; // exclusive
  initialEquity?: number;
  includeTrades?: boolean;
}
export interface BacktestDataQuality {
  checkedBars: number; zeroVolumeBars: number; discontinuities: number; eligibleForPromotion: boolean; note: string;
}
export interface BacktestResult {
  dataQuality: BacktestDataQuality;
  fixedCostUsdPerFill: number; totalFixedCostsUsd: number;
  engineVersion: string; tradeLog?: BacktestTrade[]; evaluatedBars: number;
  periodStart: number; periodEnd: number; initialEquity: number;
  symbol: string; interval: string; from: string; to: string; bars: number;
  trades: number; winRatePct: number | null; totalReturnPct: number; cagrPct: number | null;
  sharpe: number | null; maxDrawdownPct: number; profitFactor: number | null; avgR: number | null;
  exposurePct: number; finalEquity: number; equityCurve: number[]; note?: string;
}

export function runBacktest(candles: Candle[], s: StrategySpec, riskOn?: (boolean | null)[], factors?: Record<string, Series>, options: BacktestOptions = {}): BacktestResult {
  if (candles.length <= 60) throw new Error("Need more than 60 candles");
  for (const [name, value] of Object.entries({ riskPct: s.riskPct, maxLeverage: s.maxLeverage ?? 1 })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Invalid ${name}`);
  }
  for (const value of [s.feeBps ?? 5, s.slippageBps ?? 2, s.fixedCostUsdPerFill ?? 0]) if (!Number.isFinite(value) || value < 0) throw new Error("Invalid trading costs");
  for (const value of [s.stopLossAtr, s.stopLossPct, s.takeProfitR, s.takeProfitPct, s.trailAtr, s.maxHoldingBars]) if (value != null && (!Number.isFinite(value) || value <= 0)) throw new Error("Invalid stop, target or holding period");
  const res = resolver(candles, factors);
  const atr14 = atr(candles, 14);
  const fee = (s.feeBps ?? 5) / 10000, slip = (s.slippageBps ?? 2) / 10000;
  const fixedCost = s.fixedCostUsdPerFill ?? 0;
  const start = options.initialEquity ?? 10000;
  if (!Number.isFinite(start) || start <= 0) throw new Error("Invalid initial equity");
  const tradeLog: BacktestTrade[] = [];
  let equity = start, peak = start, maxDD = 0, grossWin = 0, grossLoss = 0, wins = 0, barsIn = 0;
  const rMult: number[] = [];
  let pos: null | { dir: 1 | -1; entry: number; stop: number; tp: number | null; risk: number; units: number; trail: number | null; entryFee: number; enteredAt: number } = null;
  const curve: number[] = [];
  const periods = [s.entryLong, s.entryShort, s.exitLong, s.exitShort].flatMap((cs) => (cs ?? []).flatMap((c) => [c.left.period ?? 0, c.right.period ?? 0]));
  const minimumWarm = Math.max(60, ...periods.map((p) => p + 1));
  const warm = options.startIndex ?? minimumWarm;
  const end = options.endIndex ?? candles.length;
  if (!Number.isInteger(warm) || !Number.isInteger(end) || warm < minimumWarm || end <= warm || end > candles.length) throw new Error("Invalid evaluation window or insufficient indicator warm-up");

  // Include indicator warm-up, but never inspect bars after the requested window.
  const step = 365 * 864e5 / BARS_PER_YEAR[s.interval];
  if (!Number.isFinite(step) || step <= 0) throw new Error("Unsupported candle interval");
  let zeroVolumeBars = 0, discontinuities = 0;
  for (let i = 0; i < end; i++) {
    const c = candles[i];
    if (![c.time, c.open, c.high, c.low, c.close, c.volume].every(Number.isFinite) ||
        Math.min(c.open, c.high, c.low, c.close) <= 0 || c.volume < 0 ||
        c.high < Math.max(c.open, c.close) || c.low > Math.min(c.open, c.close) || c.low > c.high)
      throw new Error(`Invalid candle at index ${i}`);
    if (c.volume === 0) zeroVolumeBars++;
    if (i && c.time - candles[i - 1].time !== step) discontinuities++;
  }
  const dataQuality: BacktestDataQuality = {
    checkedBars: end, zeroVolumeBars, discontinuities,
    eligibleForPromotion: zeroVolumeBars === 0 && discontinuities === 0,
    note: "Checks all supplied warm-up and evaluation bars through endIndex. Zero volume may mean no trading or provider-filled data; fills and signals are unvalidated. Clean candles alone do not establish executable fills or profitability.",
  };

  const closeTrade = (exit: number, exitIndex: number, exitReason: BacktestTrade["exitReason"]) => {
    if (!pos) return;
    const pnl = (exit - pos.entry) * pos.dir * pos.units - exit * pos.units * fee - fixedCost;
    const netPnl = pnl - pos.entryFee;
    const rMultiple = netPnl / (pos.risk * pos.units || 1);
    if (options.includeTrades) tradeLog.push({ entryTime: candles[pos.enteredAt].time, exitTime: exitReason === "end" ? candles[exitIndex].time + 365 * 864e5 / BARS_PER_YEAR[s.interval] : candles[exitIndex].time, side: pos.dir === 1 ? "long" : "short", entryPrice: pos.entry, exitPrice: exit, units: pos.units, fees: pos.entryFee + exit * pos.units * fee + fixedCost, netPnl, rMultiple, exitReason });
    equity += pnl; rMult.push(rMultiple);
    if (netPnl > 0) { wins++; grossWin += netPnl; } else grossLoss += -netPnl;
    pos = null;
  };

  for (let i = warm; i < end; i++) {
    const c = candles[i];
    if (pos) {
      // Close-derived signals become executable at the following open.
      if (evalConds(pos.dir === 1 ? s.exitLong : s.exitShort, res, i - 1) ||
          (s.maxHoldingBars != null && i - pos.enteredAt >= s.maxHoldingBars)) {
        closeTrade(c.open * (1 - pos.dir * slip), i, s.maxHoldingBars != null && i - pos.enteredAt >= s.maxHoldingBars ? "time" : "signal");
      }
    }
    if (!pos && equity > 0) {
      const signal = i - 1;
      const macroLong = !riskOn || riskOn[signal] === true, macroShort = !riskOn || riskOn[signal] === false;
      const wantLong = (s.direction === "long" || s.direction === "both") && macroLong && evalConds(s.entryLong, res, signal);
      const wantShort = (s.direction === "short" || s.direction === "both") && macroShort && evalConds(s.entryShort, res, signal);
      const dir: 1 | -1 | 0 = wantLong ? 1 : wantShort ? -1 : 0;
      if (dir !== 0 && atr14[signal] != null && atr14[signal]! > 0) {
        const entry = c.open * (1 + dir * slip);
        const risk = s.stopLossAtr ? atr14[signal]! * s.stopLossAtr : s.stopLossPct ? entry * s.stopLossPct / 100 : atr14[signal]! * 1.5;
        // Reserve both fixed fees before allocating risk and notional. This is a USD
        // approximation; it does not model a separate native-token gas balance.
        const units = Math.min(Math.max(0, equity * s.riskPct / 100 - 2 * fixedCost) / risk,
          Math.max(0, equity - 2 * fixedCost) * (s.maxLeverage ?? 1) / (entry * (1 + fee)));
        const tp = s.takeProfitR ? entry + dir * risk * s.takeProfitR : s.takeProfitPct ? entry * (1 + dir * s.takeProfitPct / 100) : null;
        const entryFee = entry * units * fee + fixedCost;
        if (units > 0) {
          pos = { dir, entry, stop: entry - dir * risk, tp, risk, units, trail: s.trailAtr ?? null, entryFee, enteredAt: i };
          equity -= entryFee;
        }
      }
    }
    if (pos) {
      barsIn++;
      let exited = false;
      if (pos.dir === 1) {
        if (c.low <= pos.stop) { closeTrade(Math.min(c.open, pos.stop) * (1 - slip), i, "stop"); exited = true; }
        else if (pos.tp && c.high >= pos.tp) { closeTrade(pos.tp * (1 - slip), i, "target"); exited = true; }
      } else {
        if (c.high >= pos.stop) { closeTrade(Math.max(c.open, pos.stop) * (1 + slip), i, "stop"); exited = true; }
        else if (pos.tp && c.low <= pos.tp) { closeTrade(pos.tp * (1 + slip), i, "target"); exited = true; }
      }
      // Today's trailing update only applies to subsequent candles.
      if (!exited && pos && pos.trail != null && atr14[i] != null) {
        const t = c.close - pos.dir * atr14[i]! * pos.trail;
        pos.stop = pos.dir === 1 ? Math.max(pos.stop, t) : Math.min(pos.stop, t);
      }
    }
    if (i === end - 1 && pos) closeTrade(c.close * (1 - pos.dir * slip), i, "end");
    const mark = pos ? equity + (c.close - pos.entry) * pos.dir * pos.units : equity;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak);
    curve.push(mark);
  }


  const trades = rMult.length;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) if (curve[i - 1] > 0) rets.push(curve[i] / curve[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const bpy = BARS_PER_YEAR[s.interval] ?? 365;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(bpy) : null;
  const durYears = (end - warm) / bpy;
  const totalReturnPct = (equity - start) / start * 100;
  const cagr = durYears > 0 && equity > 0 ? (Math.pow(equity / start, 1 / durYears) - 1) * 100 : null;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ds = curve.filter((_, i) => i % Math.max(1, Math.floor(curve.length / 40)) === 0 || i === curve.length - 1).map((value) => Math.round(value * 100) / 100);

  return {
    fixedCostUsdPerFill: fixedCost, totalFixedCostsUsd: trades * 2 * fixedCost,
    dataQuality,
    engineVersion: "2.3-data-quality", evaluatedBars: end - warm, initialEquity: start,
    periodStart: candles[warm].time, periodEnd: candles[end - 1].time + 365 * 864e5 / BARS_PER_YEAR[s.interval],
    ...(options.includeTrades ? { tradeLog } : {}),
    symbol: okxInst(s.symbol), interval: s.interval, from: fmt(candles[warm]?.time ?? candles[0].time), to: fmt(candles[end - 1].time), bars: candles.length,
    trades, winRatePct: trades ? Math.round((wins / trades) * 1000) / 10 : null,
    totalReturnPct: Math.round(totalReturnPct * 10) / 10, cagrPct: cagr != null ? Math.round(cagr * 10) / 10 : null,
    sharpe: sharpe != null ? Math.round(sharpe * 100) / 100 : null, maxDrawdownPct: Math.round(maxDD * 1000) / 10,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? null : 0),
    avgR: trades ? Math.round((rMult.reduce((a, b) => a + b, 0) / trades) * 100) / 100 : null,
    exposurePct: Math.round((barsIn / (end - warm)) * 1000) / 10, finalEquity: Math.round(equity * 100) / 100, equityCurve: ds,
    note: "Research simulation: next-open signals, stop-first intrabar ambiguity, capped notional. OKX spot proxy; funding, liquidation and market impact are not modeled. An optional constant USD cost is charged per fill; historical gas, separate native gas balances, approvals and unwraps are not modeled. No profitability claim.",
  };
}
