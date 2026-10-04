import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { OrderlyClient } from "../../../../lib/server/orderly";
import { loadOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

  // loadOrderly is scoped to this user + agent — no cross-tenant access possible.
  const creds = await loadOrderly(s.userId, agentId);
  if (!creds) return NextResponse.json({ connected: false });
  try {
    const client = new OrderlyClient(creds);
    const [balance, positions, stats] = await Promise.all([client.getBalance(), client.getPositions(), client.getStatistics()]);
    const open = positions.filter((p: any) => Number(p.position_qty) !== 0);
    return NextResponse.json({
      connected: true, network: creds.network,
      equity: Number(balance?.total_collateral_value) || 0,
      freeCollateral: Number(balance?.free_collateral) || 0,
      openPositions: open.length, positions: open,
      realizedPnl30d: Number(stats?.pnl_30d ?? 0) || 0,
      winRate: stats?.win_rate != null ? Number(stats.win_rate) : null,
    });
  } catch (e) {
    return NextResponse.json({ connected: true, network: creds.network, error: e instanceof Error ? e.message : "fetch failed" });
  }
}
