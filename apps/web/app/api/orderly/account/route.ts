import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { OrderlyClient } from "../../../../lib/server/orderly";
import { loadOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const creds = await loadOrderly(s.userId);
  if (!creds) return NextResponse.json({ connected: false });
  try {
    const client = new OrderlyClient(creds);
    const [balance, positions, stats] = await Promise.all([
      client.getBalance(),
      client.getPositions(),
      client.getStatistics(),
    ]);
    const openPositions = positions.filter((p: any) => Number(p.position_qty) !== 0);
    return NextResponse.json({
      connected: true,
      network: creds.network,
      equity: Number(balance?.total_collateral_value) || 0,
      freeCollateral: Number(balance?.free_collateral) || 0,
      openPositions: openPositions.length,
      positions: openPositions,
      realizedPnl30d: stats?.perp_trading_volume != null ? Number(stats?.pnl_30d ?? 0) : 0,
      winRate: stats?.win_rate != null ? Number(stats.win_rate) : null,
    });
  } catch (e) {
    return NextResponse.json({ connected: true, network: creds.network, error: e instanceof Error ? e.message : "fetch failed" }, { status: 200 });
  }
}
