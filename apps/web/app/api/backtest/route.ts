import { NextRequest, NextResponse } from "next/server";
import OpenAI from "openai";
import { getSession } from "../../../lib/server/auth";
import { fetchHistory, fetchHistoryOnchain, runBacktest } from "../../../lib/server/backtest";
import { getActiveStrategy } from "../../../lib/server/strategy-sql";
import { query } from "../../../lib/server/db";

export const runtime = "nodejs";
export const maxDuration = 90;

const DSL = "Indicators (ind): close open high low volume ema sma rsi atr roc macd_line macd_signal macd_hist bb_upper bb_mid bb_lower donchian_high donchian_low. Operand = {ind,period?} or {value}. Condition = {left:Operand, op, right:Operand}, op ∈ >,<,>=,<=,cross_above,cross_below.";

/** Compile a prose trading thesis into a runnable spec via the LLM. Returns null if it's not mechanically testable. */
async function compileThesis(thesis: string, fallbackSymbol: string, fallbackInterval: string): Promise<any | null> {
  if (!process.env.OPENAI_API_KEY || !thesis?.trim()) return null;
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o";
  const sys = `Translate the trading strategy into a JSON spec a backtester can run. ${DSL}
Return ONLY JSON: {"testable":true,"symbol","interval":"15m|1h|4h|1d","direction":"long|short|both","entryLong":[Condition...],"exitLong":[Condition...],"entryShort":[...],"exitShort":[...],"stopLossAtr":number,"takeProfitR":number,"riskPct":number}. Use ATR stop ~2 and takeProfitR ~2 if unspecified. If the strategy is discretionary/qualitative and cannot be expressed as mechanical indicator conditions, return {"testable":false}.`;
  try {
    const r = await client.chat.completions.create({ model, response_format: { type: "json_object" }, messages: [{ role: "system", content: sys }, { role: "user", content: `Symbol default ${fallbackSymbol}, interval default ${fallbackInterval}.\n\nStrategy:\n${thesis.slice(0, 3000)}` }] });
    const spec = JSON.parse(r.choices[0]?.message?.content || "{}");
    if (spec.testable === false || !(spec.entryLong?.length || spec.entryShort?.length)) return null;
    return spec;
  } catch { return null; }
}

type Cond = { left: any; op: string; right: any };
// Named strategy presets → entry/exit conditions the engine understands.
function preset(name: string): { entryLong: Cond[]; exitLong: Cond[]; entryShort: Cond[]; exitShort: Cond[] } {
  const ema = { entryLong: [{ left: { ind: "ema", period: 20 }, op: "cross_above", right: { ind: "ema", period: 50 } }], exitLong: [{ left: { ind: "ema", period: 20 }, op: "cross_below", right: { ind: "ema", period: 50 } }], entryShort: [{ left: { ind: "ema", period: 20 }, op: "cross_below", right: { ind: "ema", period: 50 } }], exitShort: [{ left: { ind: "ema", period: 20 }, op: "cross_above", right: { ind: "ema", period: 50 } }] };
  const rsi = { entryLong: [{ left: { ind: "rsi", period: 14 }, op: "<", right: { value: 30 } }], exitLong: [{ left: { ind: "rsi", period: 14 }, op: ">", right: { value: 55 } }], entryShort: [{ left: { ind: "rsi", period: 14 }, op: ">", right: { value: 70 } }], exitShort: [{ left: { ind: "rsi", period: 14 }, op: "<", right: { value: 45 } }] };
  const donchian = { entryLong: [{ left: { ind: "close" }, op: "cross_above", right: { ind: "donchian_high", period: 20 } }], exitLong: [{ left: { ind: "close" }, op: "cross_below", right: { ind: "donchian_low", period: 20 } }], entryShort: [{ left: { ind: "close" }, op: "cross_below", right: { ind: "donchian_low", period: 20 } }], exitShort: [{ left: { ind: "close" }, op: "cross_above", right: { ind: "donchian_high", period: 20 } }] };
  const macd = { entryLong: [{ left: { ind: "macd_line" }, op: "cross_above", right: { ind: "macd_signal" } }], exitLong: [{ left: { ind: "macd_line" }, op: "cross_below", right: { ind: "macd_signal" } }], entryShort: [{ left: { ind: "macd_line" }, op: "cross_below", right: { ind: "macd_signal" } }], exitShort: [{ left: { ind: "macd_line" }, op: "cross_above", right: { ind: "macd_signal" } }] };
  return ({ ema, rsi, donchian, macd } as any)[name] ?? ema;
}

export async function POST(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as any;
  const symbol = String(b.symbol || "BTC").trim();
  const interval = ["15m", "1h", "4h", "1d"].includes(b.interval) ? b.interval : "1d";
  const years = Math.min(Math.max(Number(b.years) || 3, 0.25), 10);
  const direction = ["long", "short", "both"].includes(b.direction) ? b.direction : "long";
  const riskPct = Math.min(Math.max(Number(b.riskPct) || 1, 0.1), 5);
  const p = preset(String(b.preset || "ema"));

  // ── Backtest the AGENT'S OWN strategy (stored runnable spec, or compiled from its thesis) ──
  if (b.agentId) {
    const strat = await getActiveStrategy(s.userId, String(b.agentId));
    let spec: any = strat?.spec;
    let version: number | null = strat?.version ?? null;
    let compiled = false;
    if (!spec || !(spec.entryLong?.length || spec.entryShort?.length)) {
      // Use the versioned strategy thesis, or fall back to the agent's creation instructions.
      let thesis = strat?.thesis;
      if (!thesis) {
        const ar = await query<any>("SELECT instructions FROM agents WHERE id=$1 AND user_id=$2", [String(b.agentId), s.userId]);
        if (!ar.rows.length) return NextResponse.json({ error: "Agent not found." }, { status: 200 });
        thesis = ar.rows[0].instructions;
      }
      if (!thesis?.trim()) return NextResponse.json({ error: "This agent has no strategy text yet. Give it a strategy in its instructions or in chat." }, { status: 200 });
      spec = await compileThesis(thesis, symbol, interval);
      compiled = true;
      if (!spec) return NextResponse.json({ error: "This agent's strategy is discretionary/qualitative and can't be mechanically backtested. Refine it into rule-based conditions, or use a preset here." }, { status: 200 });
    }
    const sym = spec.symbol || symbol;
    const iv = ["15m", "1h", "4h", "1d"].includes(spec.interval) ? spec.interval : interval;
    try {
      let candles, ds = "perp:okx", label2 = sym;
      if (spec.network || spec.address) { const r = await fetchHistoryOnchain(spec.network || "eth", { address: spec.address, pool: spec.pool }, iv); candles = r.candles; ds = `onchain:${spec.network || "eth"}`; label2 = sym || spec.address; }
      else candles = await fetchHistory(sym, iv, years);
      if (!candles || candles.length < 60) return NextResponse.json({ error: `Not enough history (${candles?.length ?? 0} bars) to test ${label2} ${iv}.` }, { status: 200 });
      const full = { ...spec, symbol: sym, interval: iv, years, direction: spec.direction || direction, riskPct: spec.riskPct || riskPct, feeBps: 5, slippageBps: 2 };
      const res = runBacktest(candles, full);
      return NextResponse.json({ ok: true, result: { ...res, symbol: label2, dataSource: ds, preset: version != null ? `strategy v${version}` : "agent instructions", strategyVersion: version, compiled } });
    } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : "Backtest failed" }, { status: 200 }); }
  }

  try {
    let candles, label = symbol, dataSource = "perp:okx";
    if (b.network || b.address || b.pool) {
      const r = await fetchHistoryOnchain(b.network || "eth", { pool: b.pool, address: b.address }, interval);
      candles = r.candles; label = symbol || b.address; dataSource = `onchain:${b.network || "eth"}`;
    } else {
      candles = await fetchHistory(symbol, interval, years);
    }
    if (!candles || candles.length < 60) return NextResponse.json({ error: `Not enough history (${candles?.length ?? 0} bars) for ${label} ${interval}.` }, { status: 200 });

    const spec: any = {
      symbol, interval, years, direction, riskPct,
      entryLong: p.entryLong, exitLong: p.exitLong,
      entryShort: direction === "long" ? [] : p.entryShort, exitShort: direction === "long" ? [] : p.exitShort,
      stopLossAtr: Number(b.stopLossAtr) || 2, takeProfitR: Number(b.takeProfitR) || 2,
      trailAtr: b.trailAtr ? Number(b.trailAtr) : undefined, feeBps: 5, slippageBps: 2,
    };
    const res = runBacktest(candles, spec);
    return NextResponse.json({ ok: true, result: { ...res, symbol: label, dataSource, preset: b.preset || "ema" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Backtest failed" }, { status: 200 });
  }
}
