/**
 * Market data + indicators for the Vercel app (vendored from @midas/analysis,
 * verified live against Orderly public endpoints). No credentials required.
 */
const BASE = process.env.ORDERLY_BASE_URL || "https://api-evm.orderly.org";

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number; }

export function normalizeSymbol(input: string): string {
  const s = input.trim().toUpperCase();
  if (s.startsWith("PERP_")) return s;
  const base = s.replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
  return `PERP_${base}_USDC`;
}

// Orderly natively supports these TV resolutions. 4h is not native — aggregate from 1h.
const NATIVE: Record<string, { tv: string; sec: number }> = {
  "1m": { tv: "1", sec: 60 }, "5m": { tv: "5", sec: 300 }, "15m": { tv: "15", sec: 900 },
  "30m": { tv: "30", sec: 1800 }, "1h": { tv: "60", sec: 3600 },
  "1d": { tv: "1D", sec: 86400 }, "1w": { tv: "1W", sec: 604800 },
};

async function fetchNative(sym: string, interval: string, limit: number): Promise<Candle[]> {
  const { tv, sec } = NATIVE[interval] ?? NATIVE["1h"];
  const to = Math.floor(Date.now() / 1000);
  const from = to - (Math.min(limit, 1000) + 1) * sec;
  const res = await fetch(`${BASE}/v1/tv/history?symbol=${sym}&resolution=${tv}&from=${from}&to=${to}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Orderly kline ${res.status}`);
  const d = (await res.json()) as { s: string; t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[] };
  if (d.s !== "ok" || !d.t) return [];
  return d.t.map((t, i) => ({ time: t * 1000, open: +d.o![i], high: +d.h![i], low: +d.l![i], close: +d.c![i], volume: +(d.v?.[i] ?? 0) }));
}

/** Bucket N base candles into one (open=first, close=last, high=max, low=min, vol=sum). */
function aggregate(base: Candle[], factor: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i + factor <= base.length; i += factor) {
    const g = base.slice(i, i + factor);
    out.push({
      time: g[0].time, open: g[0].open, close: g[g.length - 1].close,
      high: Math.max(...g.map((c) => c.high)), low: Math.min(...g.map((c) => c.low)),
      volume: g.reduce((a, c) => a + c.volume, 0),
    });
  }
  return out;
}

export async function getCandles(symbol: string, interval = "1h", limit = 250): Promise<Candle[]> {
  const sym = normalizeSymbol(symbol);
  if (interval === "4h") return aggregate(await fetchNative(sym, "1h", limit * 4 + 4), 4);
  return fetchNative(sym, interval, limit);
}

export async function getSnapshot(symbol: string) {
  const sym = normalizeSymbol(symbol);
  const res = await fetch(`${BASE}/v1/public/futures/${sym}`, { signal: AbortSignal.timeout(10_000) });
  const j = (await res.json()) as { data?: any };
  const info = j.data;
  const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const open = Number(info?.["24h_open"]); const close = Number(info?.["24h_close"] ?? info?.last_price);
  return {
    symbol: sym, markPrice: n(info?.mark_price), indexPrice: n(info?.index_price),
    lastPrice: n(info?.["24h_close"] ?? info?.last_price),
    change24hPct: Number.isFinite(open) && open ? ((close - open) / open) * 100 : null,
    high24h: n(info?.["24h_high"]), low24h: n(info?.["24h_low"]), volume24h: n(info?.["24h_volume"] ?? info?.["24h_amount"]),
    openInterest: n(info?.open_interest), fundingRate: n(info?.est_funding_rate ?? info?.last_funding_rate),
    nextFundingTime: n(info?.next_funding_time),
  };
}

// --- indicators ---
function ema(v: number[], p: number): (number | null)[] {
  const out: (number | null)[] = []; const k = 2 / (p + 1); let prev: number | null = null;
  for (let i = 0; i < v.length; i++) {
    if (i < p - 1) { out.push(null); continue; }
    if (prev === null) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += v[j]; prev = s / p; }
    else prev = v[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}
function sma(v: number[], p: number): (number | null)[] {
  const out: (number | null)[] = []; let sum = 0;
  for (let i = 0; i < v.length; i++) { sum += v[i]; if (i >= p) sum -= v[i - p]; out.push(i >= p - 1 ? sum / p : null); }
  return out;
}
function rsi(c: number[], p = 14): number | null {
  if (c.length <= p) return null; let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; if (d >= 0) g += d; else l -= d; }
  let ag = g / p, al = l / p;
  for (let i = p + 1; i < c.length; i++) { const d = c[i] - c[i - 1]; ag = (ag * (p - 1) + Math.max(d, 0)) / p; al = (al * (p - 1) + Math.max(-d, 0)) / p; }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function atr(c: Candle[], p = 14): number | null {
  if (c.length <= p) return null;
  const tr = c.map((x, i) => i === 0 ? x.high - x.low : Math.max(x.high - x.low, Math.abs(x.high - c[i - 1].close), Math.abs(x.low - c[i - 1].close)));
  let prev = tr.slice(1, p + 1).reduce((a, b) => a + b, 0) / p;
  for (let i = p + 1; i < c.length; i++) prev = (prev * (p - 1) + tr[i]) / p;
  return prev;
}
const last = <T,>(a: (T | null)[]): T | null => { for (let i = a.length - 1; i >= 0; i--) if (a[i] !== null) return a[i] as T; return null; };

export function summarize(candles: Candle[]) {
  const c = candles.map((x) => x.close);
  const macdLine = c.map((_, i) => { const f = ema(c, 12)[i], s = ema(c, 26)[i]; return f !== null && s !== null ? f - s : null; });
  const signal = ema(macdLine.map((x) => x ?? 0), 9);
  const m = last(macdLine), sg = signal[signal.length - 1] ?? null;
  return {
    lastClose: c[c.length - 1] ?? null,
    rsi14: rsi(c, 14), ema20: last(ema(c, 20)), ema50: last(ema(c, 50)), sma200: last(sma(c, 200)),
    atr14: atr(candles, 14), macdHistogram: m !== null && sg !== null ? m - sg : null,
  };
}
