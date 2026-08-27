import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { OrderlyClient } from "../../../../lib/server/orderly";
import { loadOrderly } from "../../../../lib/server/orderly-sql";
import { checkOrder } from "../../../../lib/server/risk";
import { getSnapshot, normalizeSymbol } from "../../../../lib/server/market";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Execute an order on the agent's OWN segregated Orderly account. Risk-gated. */
export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as any;
  const { agentId, symbol, side, type = "MARKET", quantity, price, stopLoss, reduceOnly } = b;
  if (!agentId || !symbol || !side || !quantity) return NextResponse.json({ error: "agentId, symbol, side, quantity required" }, { status: 400 });

  const creds = await loadOrderly(s.userId, agentId); // scoped: this user + this agent only
  if (!creds) return NextResponse.json({ error: "This agent has no connected Orderly account." }, { status: 400 });

  try {
    const sym = normalizeSymbol(symbol);
    const client = new OrderlyClient(creds);
    const balance = await client.getBalance();
    const equity = Number(balance?.total_collateral_value) || 0;
    // Reference price for risk: limit price, else live mark.
    const refPrice = type === "LIMIT" && price ? Number(price) : (await getSnapshot(symbol)).markPrice || 0;

    const verdict = checkOrder({ price: refPrice, quantity: Number(quantity), equityUsd: equity, stopLoss: stopLoss ? Number(stopLoss) : undefined });
    if (!verdict.ok) return NextResponse.json({ placed: false, blockedByRiskEngine: true, violations: verdict.violations }, { status: 200 });

    const result = await client.placeOrder({
      symbol: sym,
      side: side === "long" ? "BUY" : "SELL",
      order_type: type,
      order_quantity: Number(quantity),
      ...(type === "LIMIT" && price ? { order_price: Number(price) } : {}),
      ...(reduceOnly ? { reduce_only: true } : {}),
    });
    return NextResponse.json({ placed: true, network: creds.network, order: result, notionalUsd: verdict.notionalUsd });
  } catch (e) {
    return NextResponse.json({ placed: false, error: e instanceof Error ? e.message : "Order failed" }, { status: 200 });
  }
}
