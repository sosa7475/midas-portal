/**
 * Orderly Network public market data — no auth required.
 * These endpoints power the analysis tools with zero credentials.
 * (Private account/trade endpoints live in @midas/api's orderly service and
 * need ed25519 signing — Phase 3.)
 */
import type { Candle, MarketSnapshot } from "./types.js";

const BASE = process.env.ORDERLY_BASE_URL || "https://api-evm.orderly.org";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Orderly ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as { success?: boolean; data?: T };
  if (json.data === undefined) throw new Error(`Orderly ${path}: no data`);
  return json.data;
}

/** Normalize a user symbol ("BTC", "btc", "PERP_BTC_USDC") to Orderly's PERP_x_USDC. */
export function normalizeSymbol(input: string): string {
  const s = input.trim().toUpperCase();
  if (s.startsWith("PERP_")) return s;
  const base = s.replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
  return `PERP_${base}_USDC`;
}

/** interval -> { TradingView resolution, seconds per bar }. */
const INTERVAL_MAP: Record<string, { tv: string; sec: number }> = {
  "1m": { tv: "1", sec: 60 },
  "5m": { tv: "5", sec: 300 },
  "15m": { tv: "15", sec: 900 },
  "30m": { tv: "30", sec: 1800 },
  "1h": { tv: "60", sec: 3600 },
  "4h": { tv: "240", sec: 14400 },
  "1d": { tv: "1D", sec: 86400 },
  "1w": { tv: "1W", sec: 604800 },
};

/** Candles via Orderly's public TradingView UDF history endpoint (columnar arrays). */
export async function getCandles(
  symbol: string,
  interval = "1h",
  limit = 200
): Promise<Candle[]> {
  const sym = normalizeSymbol(symbol);
  const { tv, sec } = INTERVAL_MAP[interval] ?? INTERVAL_MAP["1h"];
  const to = Math.floor(Date.now() / 1000);
  const from = to - (Math.min(limit, 1000) + 1) * sec;

  const res = await fetch(
    `${BASE}/v1/tv/history?symbol=${sym}&resolution=${tv}&from=${from}&to=${to}`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!res.ok) throw new Error(`Orderly kline ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const d = (await res.json()) as {
    s: string;
    t?: number[]; o?: number[]; h?: number[]; l?: number[]; c?: number[]; v?: number[];
  };
  if (d.s !== "ok" || !d.t) return [];
  return d.t.map((t, i) => ({
    time: t * 1000,
    open: Number(d.o![i]),
    high: Number(d.h![i]),
    low: Number(d.l![i]),
    close: Number(d.c![i]),
    volume: Number(d.v?.[i] ?? 0),
  }));
}

export async function getSnapshot(symbol: string): Promise<MarketSnapshot> {
  const sym = normalizeSymbol(symbol);
  const info = await get<any>(`/v1/public/futures/${sym}`).catch(() => null);
  return {
    symbol: sym,
    markPrice: num(info?.mark_price),
    indexPrice: num(info?.index_price),
    lastPrice: num(info?.last_price ?? info?.["24h_close"]),
    change24hPct: pct(info),
    high24h: num(info?.["24h_high"]),
    low24h: num(info?.["24h_low"]),
    volume24h: num(info?.["24h_volume"] ?? info?.["24h_amount"]),
    openInterest: num(info?.open_interest),
    fundingRate: num(info?.est_funding_rate ?? info?.last_funding_rate),
    nextFundingTime: num(info?.next_funding_time),
  };
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(info: any): number | null {
  const open = Number(info?.["24h_open"]);
  const close = Number(info?.["24h_close"] ?? info?.last_price);
  if (!Number.isFinite(open) || !Number.isFinite(close) || open === 0) return null;
  return ((close - open) / open) * 100;
}
