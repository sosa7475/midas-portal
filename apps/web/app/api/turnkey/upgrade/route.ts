import { NextRequest, NextResponse } from "next/server";
import { recentOwnerRequest } from "../../../../lib/server/owner-request";
import { loadKeysetPublic, assertAgentOwned } from "../../../../lib/server/turnkey-sql";
import { addRouterPolicy, EVM_ROUTERS, turnkeyReady } from "../../../../lib/server/turnkey";

export const runtime = "nodejs";
export const maxDuration = 30;

// Grant an already-provisioned agent wallet the current multi-chain router allow-list
// Replaces legacy trade-only policies with chain and recipient restrictions.
export async function POST(req: NextRequest) {
  const s = await recentOwnerRequest(req);
  if (!s) return NextResponse.json({ error: "Reauthenticate in Trading control before changing custody settings" }, { status: 401 });
  if (!turnkeyReady()) return NextResponse.json({ error: "Turnkey not configured." }, { status: 400 });
  const { agentId } = (await req.json().catch(() => ({}))) as any;
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  if (!(await assertAgentOwned(s.userId, agentId))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  const k = await loadKeysetPublic(s.userId, agentId);
  if (!k) return NextResponse.json({ error: "This agent has no on-chain wallet yet." }, { status: 400 });
  try {
    const policyId=await addRouterPolicy(k.subOrgId, EVM_ROUTERS,k.evmAddress);
    const {query}=await import("../../../../lib/server/db");
    await query("UPDATE agent_turnkey_keyset SET policy_id=$3 WHERE user_id=$1 AND agent_id=$2",[s.userId,agentId,policyId]);
    return NextResponse.json({ ok: true, chains: ["ethereum", "arbitrum", "optimism", "base", "robinhood"] });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upgrade failed" }, { status: 400 });
  }
}
