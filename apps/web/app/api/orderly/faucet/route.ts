import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { faucetTestnetUsdc } from "../../../../lib/server/orderly";
import { loadOrderly } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";

// Fund the agent's testnet Orderly account with test USDC collateral.
export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { agentId } = (await req.json().catch(() => ({}))) as any;
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  const creds = await loadOrderly(s.userId, agentId);
  if (!creds) return NextResponse.json({ error: "No connected account" }, { status: 400 });
  if (creds.network !== "testnet" || !creds.address) return NextResponse.json({ error: "Faucet is testnet-only" }, { status: 400 });
  try {
    await faucetTestnetUsdc(creds.address);
    return NextResponse.json({ funded: true, note: "1000 test USDC requested — balance updates in a few seconds." });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Faucet failed" }, { status: 400 });
  }
}
