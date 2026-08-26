import { NextRequest, NextResponse } from "next/server";
import { getCandles, getSnapshot, normalizeSymbol, summarize } from "../../../../lib/server/market";

export const runtime = "nodejs";

// Public market analysis — no auth, no credentials. GET /api/market/analyze?symbol=BTC&interval=4h
export async function GET(req: NextRequest) {
  const symbol = req.nextUrl.searchParams.get("symbol") || "BTC";
  const interval = req.nextUrl.searchParams.get("interval") || "1h";
  try {
    const [snapshot, candles] = await Promise.all([getSnapshot(symbol), getCandles(symbol, interval, 250)]);
    return NextResponse.json({ symbol: normalizeSymbol(symbol), interval, snapshot, indicators: summarize(candles), candleCount: candles.length });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Analysis failed" }, { status: 502 });
  }
}
