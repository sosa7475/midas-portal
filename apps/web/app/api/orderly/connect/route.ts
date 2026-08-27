import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { OrderlyClient, onboardOrderly } from "../../../../lib/server/orderly";
import { saveOrderly, assertAgentOwned } from "../../../../lib/server/orderly-sql";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASES = { testnet: "https://testnet-api-evm.orderly.org", mainnet: "https://api-evm.orderly.org" };

export async function POST(req: NextRequest) {
  const s = getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as any;
  const agentId = body.agentId;
  if (!agentId) return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  if (!(await assertAgentOwned(s.userId, agentId))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });

  const network: "testnet" | "mainnet" = body.network === "mainnet" ? "mainnet" : "testnet";
  const baseUrl = BASES[network];
  try {
    if (body.mode === "generate") {
      const r = await onboardOrderly({ baseUrl: BASES.testnet, chainId: 421614 });
      await saveOrderly(s.userId, agentId, { accountId: r.accountId, orderlyKey: r.orderlyKey, secretHex: r.secretHex, address: r.address, baseUrl: BASES.testnet });
      return NextResponse.json({ connected: true, network: "testnet", address: r.address });
    }
    const { accountId, orderlyKey, secretHex } = body;
    if (!accountId || !orderlyKey || !secretHex) return NextResponse.json({ error: "accountId, orderlyKey and secretHex are required" }, { status: 400 });
    const client = new OrderlyClient({ accountId, orderlyKey, secretHex, baseUrl });
    await client.getBalance(); // validates the creds before we store them
    await saveOrderly(s.userId, agentId, { accountId, orderlyKey, secretHex, baseUrl });
    return NextResponse.json({ connected: true, network });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not connect to Orderly" }, { status: 400 });
  }
}
