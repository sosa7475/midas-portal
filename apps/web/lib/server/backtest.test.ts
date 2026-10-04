import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest, fetchHistory, type Candle, type StrategySpec } from "./backtest";
import { judge } from "./strategy-review";

const candles = (n = 64): Candle[] => Array.from({ length: n }, (_, i) => ({ time: Date.UTC(2026, 0, 1) + i * 3600000, open: 100, high: 101, low: 99, close: 100, volume: i === 59 ? 2 : 1 }));
const spec: StrategySpec = { symbol: "ETH", interval: "1h", years: 0.1, direction: "long", riskPct: 1, stopLossPct: 10, feeBps: 5, slippageBps: 2, entryLong: [{ left: { ind: "volume" }, op: ">", right: { value: 1 } }] };

test("flat trade loses round-trip costs, including in win rate and avgR", () => {
  const r = runBacktest(candles(), spec);
  assert.equal(r.trades, 1); assert.equal(r.winRatePct, 0); assert.ok(r.avgR! < 0);
  assert.ok(r.finalEquity < 10000); assert.equal(r.equityCurve.at(-1), r.finalEquity);
});
test("entry waits until the following open", () => {
  const c = candles(); c[60] = { ...c[60], open: 110, high: 111, low: 109, close: 110 };
  for (let i = 61; i < c.length; i++) c[i] = { ...c[i], open: 110, high: 111, low: 109, close: 110 };
  assert.equal(runBacktest(c, { ...spec, feeBps: 0, slippageBps: 0 }).finalEquity, 10000);
});
test("a future close cannot tighten the current candle's stop", () => {
  const c = candles(63); c[61] = { ...c[61], high: 121, low: 99, close: 120 }; c[62] = { ...c[62], open: 120, high: 121, low: 119, close: 120 };
  const r = runBacktest(c, { ...spec, trailAtr: 1, feeBps: 0, slippageBps: 0 });
  assert.equal(r.finalEquity, 10200);
});
test("stop gaps fill at the worse open", () => {
  const c = candles(62); c[61] = { ...c[61], open: 80, high: 81, low: 79, close: 80 };
  assert.equal(runBacktest(c, { ...spec, feeBps: 0, slippageBps: 0 }).finalEquity, 9800);
});
test("stop wins when both stop and target are touched", () => {
  const c = candles(62); c[61] = { ...c[61], high: 120, low: 80 };
  assert.equal(runBacktest(c, { ...spec, takeProfitR: 1, feeBps: 0, slippageBps: 0 }).finalEquity, 9900);
});
test("notional is capped and short stops handle gaps", () => {
  const c = candles(62); c[61] = { ...c[61], open: 120, high: 121, low: 119, close: 120 };
  const r = runBacktest(c, { ...spec, direction: "short", entryLong: undefined, entryShort: spec.entryLong, riskPct: 100, feeBps: 0, slippageBps: 0 });
  assert.equal(r.finalEquity, 8000);
});
test("time exit closes at next open", () => {
  const c = candles(); c[62] = { ...c[62], open: 105, high: 106, low: 104, close: 105 };
  assert.equal(runBacktest(c, { ...spec, maxHoldingBars: 2, feeBps: 0, slippageBps: 0 }).finalEquity, 10050);
});
test("invalid inputs fail explicitly", () => {
  assert.throws(() => runBacktest([], spec));
  assert.throws(() => runBacktest(candles(), { ...spec, riskPct: NaN }));
});
test("promotion requires held-out evidence and profitable results", () => {
  const good = { dataQuality: { eligibleForPromotion: true }, trades: 50, sharpe: 1, totalReturnPct: 5, profitFactor: 1.3, maxDrawdownPct: 3 };
  assert.equal(judge(null, { ok: true, full: good }).win, false);
  assert.equal(judge(null, { ok: true, oos: { ...good, trades: 1 } }).win, false);
  assert.equal(judge(null, { ok: true, oos: { ...good, totalReturnPct: -1 } }).win, false);
  assert.equal(judge(null, { ok: true, oos: good }).win, true);
});
test("partial history is rejected instead of silently shortening the requested period", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ data: [[String(Date.now() - 3600000), "100", "101", "99", "100", "1", "0", "0", "1"]] }));
  try { await assert.rejects(fetchHistory("ETH", "1h", 1), /Incomplete history/); }
  finally { globalThis.fetch = original; }
});

test("long history paginates beyond the former 30-page cap", async () => {
  const original = globalThis.fetch;
  const endTime = Date.UTC(2026, 0, 1);
  let pages = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get("limit"), "300");
    const after = Number(url.searchParams.get("after"));
    pages++;
    const data = Array.from({length: 300}, (_, i) => [String(after - (i + 1) * 3600000), "100", "101", "99", "100", "1", "0", "0", "1"]);
    return new Response(JSON.stringify({code: "0", data}));
  };
  try {
    const c = await fetchHistory("ETH", "1h", 2, {endTime});
    assert.ok(pages > 30); assert.equal(c.length, 17520);
    assert.equal(c.at(-1)!.time + 3600000, endTime);
  } finally { globalThis.fetch = original; }
});

test("evaluation retains prior indicator history without including prior trades", () => {
  const c = candles(100); c[79].volume = 2;
  const r = runBacktest(c, spec, undefined, undefined, {startIndex:80,endIndex:90,includeTrades:true});
  assert.equal(r.trades, 1); assert.equal(r.tradeLog![0].entryTime, c[80].time);
  assert.equal(r.evaluatedBars, 10); assert.equal(r.periodStart, c[80].time);
  assert.equal(r.periodEnd, c[90].time);
  assert.equal(Math.round((10000+r.tradeLog!.reduce((n,t)=>n+t.netPnl,0))*100)/100,r.finalEquity);
});

test("candles after evaluation end cannot change results", () => {
  const c = candles(100); c[79].volume = 2;
  const options={startIndex:80,endIndex:90,includeTrades:true};
  const before=runBacktest(c,spec,undefined,undefined,options);
  for(let i=90;i<c.length;i++)c[i]={...c[i],open:1000,high:1200,low:900,close:1100};
  assert.deepEqual(runBacktest(c,spec,undefined,undefined,options),before);
});

test("long indicators require enough warm-up history", () => {
  const s={...spec,entryLong:[{left:{ind:"close" as const},op:">" as const,right:{ind:"ema" as const,period:200}}]};
  assert.throws(()=>runBacktest(candles(300),s,undefined,undefined,{startIndex:60}),/warm-up/);
  assert.equal(runBacktest(candles(300),s).evaluatedBars,99);
});

test("small simulated capital retains cents", () => {
 const r=runBacktest(candles(),{...spec,feeBps:0,slippageBps:0},undefined,undefined,{initialEquity:11.43});
 assert.equal(r.finalEquity,11.43); assert.equal(r.equityCurve.at(-1),11.43);
});


test("fixed costs debit both fills and reconcile with the final equity", () => {
 const r=runBacktest(candles(),{...spec,feeBps:0,slippageBps:0,fixedCostUsdPerFill:0.1},undefined,undefined,{initialEquity:100,includeTrades:true});
 assert.equal(r.trades,1);assert.equal(r.finalEquity,99.8);
 assert.equal(r.tradeLog![0].fees,0.2);assert.equal(r.tradeLog![0].netPnl,-0.2);
 assert.equal(r.equityCurve.at(-1),99.8);assert.equal(r.winRatePct,0);
});
test("fixed costs reserve cash and reduce future trade size", () => {
 const c=candles(65);c[62].volume=2;
 const r=runBacktest(c,{...spec,riskPct:100,feeBps:0,slippageBps:0,fixedCostUsdPerFill:1,maxHoldingBars:1},undefined,undefined,{initialEquity:10,includeTrades:true});
 assert.equal(r.trades,2);assert.equal(r.finalEquity,6);
 assert.equal(r.tradeLog![0].units,0.08);assert.equal(r.tradeLog![1].units,0.06);
});
test("unaffordable fixed costs cannot create negative-sized or zero-sized trades", () => {
 for(const initialEquity of [1,2]){
 const r=runBacktest(candles(),{...spec,riskPct:100,fixedCostUsdPerFill:1},undefined,undefined,{initialEquity});
 assert.equal(r.trades,0);assert.equal(r.finalEquity,initialEquity);
 }
 assert.throws(()=>runBacktest(candles(),{...spec,fixedCostUsdPerFill:-1}),/costs/);
 assert.throws(()=>runBacktest(candles(),{...spec,fixedCostUsdPerFill:NaN}),/costs/);
});
test("zero fixed cost is backward-compatible", () => {
 assert.deepEqual(runBacktest(candles(),spec),runBacktest(candles(),{...spec,fixedCostUsdPerFill:0}));
});


test("zero-volume warm-up and holding bars block promotion even without trade logs", () => {
  for (const index of [20, 60, 61, 63]) {
    const c = candles(); c[index].volume = 0;
    const r = runBacktest(c, spec);
    assert.equal(r.dataQuality.zeroVolumeBars, 1);
    assert.equal(r.dataQuality.eligibleForPromotion, false);
    assert.equal(r.tradeLog, undefined);
    const profitable = { ...r, trades: 50, sharpe: 1, totalReturnPct: 5, profitFactor: 1.3 };
    assert.equal(judge(null, { ok: true, oos: profitable }).win, false);
  }
});
test("missing and duplicate timestamps prevent promotion", () => {
  for (const shift of [-3600000, 3600000]) {
    const c = candles(); c[61].time += shift;
    assert.equal(runBacktest(c, spec).dataQuality.eligibleForPromotion, false);
  }
});
test("quality excludes future bars after endIndex", () => {
  const c = candles(70); c[69].volume = 0; c[69].time = 0;
  const r = runBacktest(c, spec, undefined, undefined, { endIndex: 64 });
  assert.equal(r.dataQuality.checkedBars, 64);
  assert.equal(r.dataQuality.eligibleForPromotion, true);
});
test("legacy results without quality evidence cannot promote", () => {
  const oos = { trades: 50, sharpe: 1, totalReturnPct: 5, profitFactor: 1.3, maxDrawdownPct: 3 };
  assert.equal(judge(null, { ok: true, oos }).win, false);
});
test("malformed candles fail explicitly", () => {
  const c = candles(); c[61].low = 102;
  assert.throws(() => runBacktest(c, spec), /Invalid candle/);
});
