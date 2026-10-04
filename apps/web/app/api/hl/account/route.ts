import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { getAccount } from "../../../../lib/server/hyperliquid";
import { loadHlPublic } from "../../../../lib/server/hl-sql";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });

  // Scoped to this user + agent — no cross-tenant access. Reads need only the address.
  const acct = await loadHlPublic(s.userId, agentId);
  if (!acct) return NextResponse.json({ connected: false });
  try {
    const a = await getAccount(acct.address, acct.network);
    return NextResponse.json({
      connected: true, network: acct.network, address: acct.address,
      equity: a.equity, freeCollateral: a.freeCollateral,
      openPositions: a.openPositions, positions: a.positions,
    });
  } catch (e) {
    return NextResponse.json({ connected: true, network: acct.network, address: acct.address, error: e instanceof Error ? e.message : "fetch failed" });
  }
}
