/**
 * Robust, deterministic strategy backtester over multi-year history.
 * Declarative condition DSL — agents express their ACTUAL strategy as entry/exit
 * conditions over a rich indicator library (no arbitrary code, fully reproducible).
 * High-fidelity: fees + slippage, ATR/%/trailing stops, R targets, no lookahead.
 * Data from OKX public candles (Binance/Bybit are US-geo-blocked).
 */
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
  defiTrendFilter?: boolean;
}

const BARS_PER_YEAR: Record<string, number> = { "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 };
const OKX_BAR: Record<string, string> = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

export function okxInst(input: string): string {
  const s = input.trim().toUpperCase().replace(/^PERP_/, "");
  const base = s.replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
  return `${base}-USDT`;
}

export async function fetchHistory(symbol: string, interval: string, years: number): Promise<Candle[]> {
  const inst = okxInst(symbol);
  const bar = OKX_BAR[interval] ?? "1D";
  const minTime = Date.now() - Math.max(0.1, years) * 365 * 864e5;
  const out: Candle[] = [];
  let after = "";
  for (let req = 0; req < 30; req++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${bar}&limit=100${after ? `&after=${after}` : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) { if (out.length) break; throw new Error(`OKX ${r.status} for ${inst}`); }
    const j = (await r.json()) as { data?: string[][] };
    const rows = j.data ?? [];
    if (!rows.length) break;
    for (const k of rows) out.push({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    after = rows[rows.length - 1][0];
    if (+after <= minTime || rows.length < 100) break;
  }
  out.sort((a, b) => a.time - b.time);
  return out.filter((c) => c.time >= minTime);
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
      default: s = c;
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

export interface BacktestResult {
  symbol: string; interval: string; from: string; to: string; bars: number;
  trades: number; winRatePct: number | null; totalReturnPct: number; cagrPct: number | null;
  sharpe: number | null; maxDrawdownPct: number; profitFactor: number | null; avgR: number | null;
  exposurePct: number; finalEquity: number; equityCurve: number[]; note?: string;
}

export function runBacktest(candles: Candle[], s: StrategySpec, riskOn?: (boolean | null)[], factors?: Record<string, Series>): BacktestResult {
  const res = resolver(candles, factors);
  const atr14 = atr(candles, 14);
  const fee = (s.feeBps ?? 5) / 10000, slip = (s.slippageBps ?? 2) / 10000;
  const start = 10000;
  let equity = start, peak = start, maxDD = 0, grossWin = 0, grossLoss = 0, wins = 0, barsIn = 0;
  const rMult: number[] = [];
  let pos: null | { dir: 1 | -1; entry: number; stop: number; tp: number | null; risk: number; units: number; trail: number | null } = null;
  const curve: number[] = [];
  const warm = 60;

  const closeTrade = (exit: number) => {
    if (!pos) return;
    const pnl = (exit - pos.entry) * pos.dir * pos.units - exit * pos.units * fee;
    equity += pnl; rMult.push(pnl / (pos.risk * pos.units || 1));
    if (pnl > 0) { wins++; grossWin += pnl; } else grossLoss += -pnl;
    pos = null;
  };

  for (let i = warm; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      barsIn++;
      // trailing stop update
      if (pos.trail != null && atr14[i] != null) {
        const t = pos.dir === 1 ? c.close - atr14[i]! * pos.trail : c.close + atr14[i]! * pos.trail;
        pos.stop = pos.dir === 1 ? Math.max(pos.stop, t) : Math.min(pos.stop, t);
      }
      let exited = false;
      if (pos.dir === 1) {
        if (c.low <= pos.stop) { closeTrade(pos.stop * (1 - slip)); exited = true; }
        else if (pos.tp && c.high >= pos.tp) { closeTrade(pos.tp * (1 - slip)); exited = true; }
      } else {
        if (c.high >= pos.stop) { closeTrade(pos.stop * (1 + slip)); exited = true; }
        else if (pos.tp && c.low <= pos.tp) { closeTrade(pos.tp * (1 + slip)); exited = true; }
      }
      if (!exited && pos) {
        const exitConds = pos.dir === 1 ? s.exitLong : s.exitShort;
        if (evalConds(exitConds, res, i)) { closeTrade(c.close * (1 - pos.dir * slip)); }
      }
    }
    if (!pos) {
      const macroLong = !riskOn || riskOn[i] === true, macroShort = !riskOn || riskOn[i] === false;
      const wantLong = (s.direction === "long" || s.direction === "both") && macroLong && evalConds(s.entryLong, res, i);
      const wantShort = (s.direction === "short" || s.direction === "both") && macroShort && evalConds(s.entryShort, res, i);
      const dir: 1 | -1 | 0 = wantLong ? 1 : wantShort ? -1 : 0;
      if (dir !== 0 && atr14[i] != null && atr14[i]! > 0) {
        const entry = c.close * (1 + dir * slip);
        const stopDist = s.stopLossAtr ? atr14[i]! * s.stopLossAtr : s.stopLossPct ? entry * (s.stopLossPct / 100) : atr14[i]! * 1.5;
        const risk = stopDist;
        const units = (equity * (s.riskPct / 100)) / risk;
        const tp = s.takeProfitR ? entry + dir * risk * s.takeProfitR : s.takeProfitPct ? entry * (1 + dir * s.takeProfitPct / 100) : null;
        pos = { dir, entry, stop: entry - dir * stopDist, tp, risk, units, trail: s.trailAtr ?? null };
        equity -= entry * units * fee;
      }
    }
    const mark = pos ? equity + (c.close - pos.entry) * pos.dir * pos.units : equity;
    peak = Math.max(peak, mark); maxDD = Math.max(maxDD, (peak - mark) / peak);
    curve.push(Math.round(mark));
  }
  if (pos) closeTrade(candles[candles.length - 1].close);

  const trades = rMult.length;
  const rets: number[] = [];
  for (let i = 1; i < curve.length; i++) if (curve[i - 1] > 0) rets.push(curve[i] / curve[i - 1] - 1);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const sd = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length || 1));
  const bpy = BARS_PER_YEAR[s.interval] ?? 365;
  const sharpe = sd > 0 ? (mean / sd) * Math.sqrt(bpy) : null;
  const durYears = candles.length / bpy;
  const totalReturnPct = (equity - start) / start * 100;
  const cagr = durYears > 0 && equity > 0 ? (Math.pow(equity / start, 1 / durYears) - 1) * 100 : null;
  const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);
  const ds = curve.filter((_, i) => i % Math.max(1, Math.floor(curve.length / 40)) === 0);

  return {
    symbol: okxInst(s.symbol), interval: s.interval, from: fmt(candles[warm]?.time ?? candles[0].time), to: fmt(candles[candles.length - 1].time), bars: candles.length,
    trades, winRatePct: trades ? Math.round((wins / trades) * 1000) / 10 : null,
    totalReturnPct: Math.round(totalReturnPct * 10) / 10, cagrPct: cagr != null ? Math.round(cagr * 10) / 10 : null,
    sharpe: sharpe != null ? Math.round(sharpe * 100) / 100 : null, maxDrawdownPct: Math.round(maxDD * 1000) / 10,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? null : 0),
    avgR: trades ? Math.round((rMult.reduce((a, b) => a + b, 0) / trades) * 100) / 100 : null,
    exposurePct: Math.round((barsIn / (candles.length - warm)) * 1000) / 10, finalEquity: Math.round(equity), equityCurve: ds,
    note: trades === 0 ? "No trades triggered — loosen the entry conditions." : undefined,
  };
}
