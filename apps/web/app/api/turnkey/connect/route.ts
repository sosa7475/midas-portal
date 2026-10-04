import {recentOwnerRequest} from "../../../../lib/server/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { turnkeyReady, provisionAgentKeyset, EVM_ROUTERS } from "../../../../lib/server/turnkey";
import { saveKeyset, loadKeysetPublic, assertAgentOwned } from "../../../../lib/server/turnkey-sql";

export const runtime = "nodejs";
export const maxDuration = 60;

// Provision a dedicated, trade-only Turnkey keyset for this agent (EVM + Solana).
export async function POST(req: NextRequest) {
  const s = await recentOwnerRequest(req);
  if (!s) return NextResponse.json({ error: "Reauthenticate in Trading control before changing custody settings" }, { status: 401 });
  if (!turnkeyReady()) return NextResponse.json({ error: "Turnkey is not configured on the server." }, { status: 400 });
  const { agentId } = (await req.json().catch(() => ({}))) as any;
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  if (!(await assertAgentOwned(s.userId, agentId))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const existing = await loadKeysetPublic(s.userId, agentId);
  if (existing) return NextResponse.json({ connected: true, ...existing });

  try {
    const k = await provisionAgentKeyset(`agent-${agentId.slice(0, 8)}`, EVM_ROUTERS);
    await saveKeyset(s.userId, agentId, { ...k, routers: EVM_ROUTERS });
    const saved=await loadKeysetPublic(s.userId,agentId);
    return NextResponse.json({connected:true,...saved});
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not provision Turnkey keyset" }, { status: 400 });
  }
}
