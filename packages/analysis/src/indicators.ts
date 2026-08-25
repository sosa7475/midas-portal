/**
 * Technical indicators — pure functions over OHLCV. No I/O, fully unit-testable.
 * All return arrays aligned to the input (leading nulls where undefined).
 */
import type { Candle } from "./types.js";

export function sma(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    out.push(i >= period - 1 ? sum / period : null);
  }
  return out;
}

export function ema(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = [];
  const k = 2 / (period + 1);
  let prev: number | null = null;
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }
    if (prev === null) {
      // Seed with SMA of the first `period` values.
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j];
      prev = sum / period;
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out.push(prev);
  }
  return out;
}

export function rsi(closes: number[], period = 14): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  if (closes.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  let avgGain = gain / period;
  let avgLoss = loss / period;
  out[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff >= 0 ? diff : 0;
    const l = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
    out[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return out;
}

export interface MacdPoint {
  macd: number | null;
  signal: number | null;
  histogram: number | null;
}

export function macd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): MacdPoint[] {
  const emaFast = ema(closes, fast);
  const emaSlow = ema(closes, slow);
  const macdLine = closes.map((_, i) =>
    emaFast[i] !== null && emaSlow[i] !== null ? emaFast[i]! - emaSlow[i]! : null
  );
  const defined = macdLine.map((v) => v ?? 0);
  const signalRaw = ema(defined, signalPeriod);
  return closes.map((_, i) => {
    const m = macdLine[i];
    const s = m === null ? null : signalRaw[i];
    return {
      macd: m,
      signal: s,
      histogram: m !== null && s !== null ? m - s : null,
    };
  });
}

export function atr(candles: Candle[], period = 14): (number | null)[] {
  const tr: number[] = candles.map((c, i) => {
    if (i === 0) return c.high - c.low;
    const prevClose = candles[i - 1].close;
    return Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  });
  // Wilder's smoothing
  const out: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length <= period) return out;
  let prev = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  out[period] = prev;
  for (let i = period + 1; i < candles.length; i++) {
    prev = (prev * (period - 1) + tr[i]) / period;
    out[i] = prev;
  }
  return out;
}

export function vwap(candles: Candle[]): (number | null)[] {
  let cumPV = 0;
  let cumV = 0;
  return candles.map((c) => {
    const typical = (c.high + c.low + c.close) / 3;
    cumPV += typical * c.volume;
    cumV += c.volume;
    return cumV === 0 ? null : cumPV / cumV;
  });
}

export interface BollingerPoint {
  middle: number | null;
  upper: number | null;
  lower: number | null;
}

export function bollinger(closes: number[], period = 20, mult = 2): BollingerPoint[] {
  const mid = sma(closes, period);
  return closes.map((_, i) => {
    if (i < period - 1 || mid[i] === null) return { middle: null, upper: null, lower: null };
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (closes[j] - mid[i]!) ** 2;
    const sd = Math.sqrt(variance / period);
    return { middle: mid[i], upper: mid[i]! + mult * sd, lower: mid[i]! - mult * sd };
  });
}

/** Swing-based support/resistance from recent pivots. */
export function supportResistance(
  candles: Candle[],
  lookback = 5,
  maxLevels = 4
): { support: number[]; resistance: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];
  for (let i = lookback; i < candles.length - lookback; i++) {
    const window = candles.slice(i - lookback, i + lookback + 1);
    const isPivotHigh = candles[i].high === Math.max(...window.map((c) => c.high));
    const isPivotLow = candles[i].low === Math.min(...window.map((c) => c.low));
    if (isPivotHigh) highs.push(candles[i].high);
    if (isPivotLow) lows.push(candles[i].low);
  }
  const last = candles[candles.length - 1]?.close ?? 0;
  const resistance = [...new Set(highs)]
    .filter((h) => h >= last)
    .sort((a, b) => a - b)
    .slice(0, maxLevels);
  const support = [...new Set(lows)]
    .filter((l) => l <= last)
    .sort((a, b) => b - a)
    .slice(0, maxLevels);
  return { support, resistance };
}

/** Convenience bundle: latest value of each indicator for a candle series. */
export function summarize(candles: Candle[]) {
  const closes = candles.map((c) => c.close);
  const latest = <T>(arr: T[]): T | null => (arr.length ? arr[arr.length - 1] : null);
  const macdSeries = macd(closes);
  return {
    lastClose: latest(closes),
    rsi14: latest(rsi(closes, 14)),
    ema20: latest(ema(closes, 20)),
    ema50: latest(ema(closes, 50)),
    sma200: latest(sma(closes, 200)),
    macd: latest(macdSeries),
    atr14: latest(atr(candles, 14)),
    vwap: latest(vwap(candles)),
    bollinger: latest(bollinger(closes)),
    levels: supportResistance(candles),
  };
}
