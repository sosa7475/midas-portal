/**
 * Deterministic strategy backtester over multi-year history.
 * High-fidelity: fees + slippage, ATR stops / R-based targets, no lookahead
 * (signal on a bar's close, indicators known at that close). Data from OKX public
 * candles (deep history, no key, reachable from US regions — Binance/Bybit are
 * geo-blocked there).
 */

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }

export interface StrategySpec {
  symbol: string;
  interval: "15m" | "1h" | "4h" | "1d";
  years: number;
  direction: "long" | "short" | "both";
  emaFast?: number;          // trend filter (with emaSlow)
  emaSlow?: number;
  rsiEntryBelow?: number;    // enter when RSI below (mean-reversion / dip)
  rsiEntryAbove?: number;    // enter when RSI above (momentum)
  useMacd?: boolean;         // require MACD histogram to agree with direction
  stopAtrMult: number;       // stop distance = ATR * mult
  takeProfitR: number;       // target = risk * R
  riskPct: number;           // % of equity risked per trade
  feeBps?: number;           // per side (default 5 = 0.05%)
  slippageBps?: number;      // per side (default 2)
}

const BARS_PER_YEAR: Record<string, number> = { "15m": 35040, "1h": 8760, "4h": 2190, "1d": 365 };
const OKX_BAR: Record<string, string> = { "15m": "15m", "1h": "1H", "4h": "4H", "1d": "1D" };

export function okxInst(input: string): string {
  const s = input.trim().toUpperCase().replace(/^PERP_/, "");
  const base = s.replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
  return `${base}-USDT`;
}

/** OKX public candles, paginated backwards (newest-first per batch, 100/req). */
export async function fetchHistory(symbol: string, interval: string, years: number): Promise<Candle[]> {
  const inst = okxInst(symbol);
  const bar = OKX_BAR[interval] ?? "1D";
  const minTime = Date.now() - Math.max(0.1, years) * 365 * 864e5;
  const out: Candle[] = [];
  let after = "";
  for (let req = 0; req < 26; req++) {
    const url = `https://www.okx.com/api/v5/market/history-candles?instId=${inst}&bar=${bar}&limit=100${after ? `&after=${after}` : ""}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(12_000) });
    if (!r.ok) { if (out.length) break; throw new Error(`OKX ${r.status} for ${inst}`); }
    const j = (await r.json()) as { data?: string[][] };
    const rows = j.data ?? [];
    if (!rows.length) break;
    for (const k of rows) out.push({ time: +k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] });
    after = rows[rows.length - 1][0]; // oldest ts in this batch
    if (+after <= minTime || rows.length < 100) break;
  }
  out.sort((a, b) => a.time - b.time);
  return out.filter((c) => c.time >= minTime);
}

// --- indicator series ---
function emaSeries(v: number[], p: number): (number | null)[] {
  const out: (number | null)[] = []; const k = 2 / (p + 1); let prev: number | null = null;
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) { out.push(null); continue; }
    if (prev === null) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += v[j]; prev = s / p; }
    else prev = v[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function rsiSeries(c: number[], p = 14): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  if (c.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  out[p] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = p + 1; i < c.length; i++) {
    const d = c[i] - c[i - 1];
    ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}
function atrSeries(c: Candle[], p = 14): (number | null)[] {
  const out: (number | null)[] = new Array(c.length).fill(null);
  if (c.length <= p) return out;
  const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
  let prev = tr.slice(1, p + 1).reduce((a, b) => a + b, 0) / p; out[p] = prev;
  for (let i = p + 1; i < c.length; i++) { prev = (prev * (p - 1) + tr[i]) / p; out[i] = prev; }
  return out;
}
function macdHistSeries(c: number[]): (number | null)[] {
  const f = emaSeries(c, 12), s = emaSeries(c, 26);
  const line = c.map((_, i) => f[i] !== null && s[i] !== null ? (f[i]! - s[i]!) : null);
  const sig = emaSeries(line.map((x) => x ?? 0), 9);
  return c.map((_, i) => line[i] !== null ? line[i]! - (sig[i] ?? 0) : null);
}

export interface BacktestResult {
  symbol: string; interval: string; from: string; to: string; bars: number;
  trades: number; winRatePct: number | null; totalReturnPct: number; cagrPct: number | null;
  sharpe: number | null; maxDrawdownPct: number; profitFactor: number | null; avgR: number | null;
  exposurePct: number; finalEquity: number; equityCurve: number[];
  note?: string;
}

export function runBacktest(candles: Candle[], s: StrategySpec): BacktestResult {
  const closes = candles.map((c) => c.close);
  const ef = s.emaFast ? emaSeries(closes, s.emaFast) : null;
  const es = s.emaSlow ? emaSeries(closes, s.emaSlow) : null;
  const rsi = (s.rsiEntryBelow != null || s.rsiEntryAbove != null) ? rsiSeries(closes, 14) : null;
  const macd = s.useMacd ? macdHistSeries(closes) : null;
  const atr = atrSeries(candles, 14);

  const fee = (s.feeBps ?? 5) / 10000;
  const slip = (s.slippageBps ?? 2) / 10000;
  const start = 10000;
  let equity = start, peak = start, maxDD = 0, grossWin = 0, grossLoss = 0, wins = 0, barsIn = 0;
  const rMultiples: number[] = [];
  let pos: null | { dir: 1 | -1; entry: number; stop: number; tp: number; units: number; risk: number } = null;
  const curve: number[] = [];

  const warm = Math.max(s.emaSlow ?? 0, 26, 15) + 1;
  const longOk = (i: number) => {
    if (ef && es) { if (ef[i] == null || es[i] == null || ef[i]! <= es[i]!) return false; }
    if (rsi) { if (rsi[i] == null) return false; if (s.rsiEntryBelow != null && !(rsi[i]! < s.rsiEntryBelow)) return false; if (s.rsiEntryAbove != null && !(rsi[i]! > s.rsiEntryAbove)) return false; }
    if (macd) { if (macd[i] == null || macd[i]! <= 0) return false; }
    return true;
  };
  const shortOk = (i: number) => {
    if (ef && es) { if (ef[i] == null || es[i] == null || ef[i]! >= es[i]!) return false; }
    if (rsi) { if (rsi[i] == null) return false; if (s.rsiEntryBelow != null && !(rsi[i]! > (100 - s.rsiEntryBelow))) return false; if (s.rsiEntryAbove != null && !(rsi[i]! < (100 - s.rsiEntryAbove))) return false; }
    if (macd) { if (macd[i] == null || macd[i]! >= 0) return false; }
    return true;
  };

  const close = (exit: number) => {
    if (!pos) return;
    barsIn += 0;
    const raw = (exit - pos.entry) * pos.dir * pos.units;
    const notionalOut = exit * pos.units;
    const pnl = raw - notionalOut * fee;
    equity += pnl;
    const r = pnl / (pos.risk * pos.units || 1);
    rMultiples.push(r);
    if (pnl > 0) { wins++; grossWin += pnl; } else grossLoss += -pnl;
    pos = null;
  };

  for (let i = warm; i < candles.length; i++) {
    const c = candles[i];
    if (pos) {
      barsIn++;
      // conservative: check stop before target within the bar
      if (pos.dir === 1) {
        if (c.low <= pos.stop) close(pos.stop * (1 - slip));
        else if (c.high >= pos.tp) close(pos.tp * (1 - slip));
      } else {
        if (c.high >= pos.stop) close(pos.stop * (1 + slip));
        else if (c.low <= pos.tp) close(pos.tp * (1 + slip));
      }
    }
    if (!pos && atr[i] != null && atr[i]! > 0) {
      const wantLong = (s.direction === "long" || s.direction === "both") && longOk(i);
      const wantShort = (s.direction === "short" || s.direction === "both") && shortOk(i);
      const dir: 1 | -1 | 0 = wantLong ? 1 : wantShort ? -1 : 0;
      if (dir !== 0) {
        const entry = c.close * (1 + dir * slip);
        const risk = atr[i]! * s.stopAtrMult;
        const units = (equity * (s.riskPct / 100)) / risk;
        pos = { dir, entry, stop: entry - dir * risk, tp: entry + dir * risk * s.takeProfitR, units, risk };
        equity -= entry * units * fee; // entry fee
      }
    }
    const mark = pos ? equity + (candles[i].close - pos.entry) * pos.dir * pos.units : equity;
    peak = Math.max(peak, mark);
    maxDD = Math.max(maxDD, (peak - mark) / peak);
    curve.push(Math.round(mark));
  }
  if (pos) close(candles[candles.length - 1].close);

  const trades = rMultiples.length;
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
  // downsample curve to ~40 points for a compact response
  const ds = curve.filter((_, i) => i % Math.max(1, Math.floor(curve.length / 40)) === 0);

  return {
    symbol: okxInst(s.symbol), interval: s.interval,
    from: fmt(candles[warm]?.time ?? candles[0].time), to: fmt(candles[candles.length - 1].time), bars: candles.length,
    trades, winRatePct: trades ? Math.round((wins / trades) * 1000) / 10 : null,
    totalReturnPct: Math.round(totalReturnPct * 10) / 10,
    cagrPct: cagr != null ? Math.round(cagr * 10) / 10 : null,
    sharpe: sharpe != null ? Math.round(sharpe * 100) / 100 : null,
    maxDrawdownPct: Math.round(maxDD * 1000) / 10,
    profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : (grossWin > 0 ? null : 0),
    avgR: trades ? Math.round((rMultiples.reduce((a, b) => a + b, 0) / trades) * 100) / 100 : null,
    exposurePct: Math.round((barsIn / (candles.length - warm)) * 1000) / 10,
    finalEquity: Math.round(equity),
    equityCurve: ds,
    note: trades === 0 ? "No trades triggered — loosen the entry conditions." : undefined,
  };
}
