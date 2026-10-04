import { test } from "node:test";
import assert from "node:assert/strict";
import { ema, rsi, sma, atr, summarize } from "./indicators.js";
import type { Candle } from "./types.js";

test("sma computes trailing average with correct leading nulls", () => {
  const r = sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(r, [null, null, 2, 3, 4]);
});

test("ema last value tracks an upward series above its start", () => {
  const r = ema([1, 2, 3, 4, 5, 6, 7, 8], 3);
  assert.equal(r[0], null);
  assert.ok((r[7] as number) > 6 && (r[7] as number) <= 8);
});

test("rsi is 100 for a monotonically rising series", () => {
  const closes = Array.from({ length: 20 }, (_, i) => i + 1);
  const r = rsi(closes, 14);
  assert.equal(r[14], 100);
});

test("rsi stays within [0,100]", () => {
  const closes = [44, 44.3, 44.1, 43.6, 44.3, 44.8, 45.1, 45.4, 45.4, 45, 44.6, 44.3, 44.7, 45.6, 46.3, 46.5];
  for (const v of rsi(closes, 14)) if (v !== null) assert.ok(v >= 0 && v <= 100);
});

test("atr is positive once seeded", () => {
  const candles: Candle[] = Array.from({ length: 20 }, (_, i) => ({
    time: i,
    open: 100 + i,
    high: 102 + i,
    low: 99 + i,
    close: 101 + i,
    volume: 10,
  }));
  const a = atr(candles, 14);
  assert.ok((a[19] as number) > 0);
});

test("summarize returns a full bundle without throwing on 250 candles", () => {
  const candles: Candle[] = Array.from({ length: 250 }, (_, i) => {
    const base = 100 + Math.sin(i / 10) * 5;
    return { time: i, open: base, high: base + 1, low: base - 1, close: base + 0.5, volume: 100 + i };
  });
  const s = summarize(candles);
  assert.ok(s.rsi14 !== null && s.ema20 !== null && s.atr14 !== null && s.sma200 !== null);
  assert.ok(Array.isArray(s.levels.support) && Array.isArray(s.levels.resistance));
});
