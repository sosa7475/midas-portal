import {recentOwnerRequest} from "../../../../lib/server/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { serializeTransaction, parseUnits, type Address } from "viem";
import { loadKeysetPublic, setOwnerAddress, assertAgentOwned } from "../../../../lib/server/turnkey-sql";
import { rootSignEvmTx } from "../../../../lib/server/turnkey";
import { buildWithdrawTx, broadcast, resolveToken, getDecimals, CHAINS } from "../../../../lib/server/dex";

export const runtime = "nodejs";
export const maxDuration = 40;

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test((s || "").trim());

// Set the owner (withdrawal) address — the ONLY destination withdrawals may go to.
export async function PUT(req: NextRequest) {
  const s = await recentOwnerRequest(req);
  if (!s) return NextResponse.json({ error: "Reauthenticate in Trading control before changing custody settings" }, { status: 401 });
  const { agentId, address } = (await req.json().catch(() => ({}))) as any;
  if (!agentId || !isAddr(address)) return NextResponse.json({ error: "agentId and a valid 0x address required" }, { status: 400 });
  if (!(await assertAgentOwned(s.userId, agentId))) return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  await setOwnerAddress(s.userId, agentId, address);
  return NextResponse.json({ ok: true, ownerAddress: address.toLowerCase() });
}

// Withdraw funds to the registered owner address. Signed by the platform ROOT key (never the
// agent key), triggered only by the authenticated owner, and destination is ALWAYS the stored
// owner address — the agent/LLM can never move funds out.
export async function POST(req: NextRequest) {
  const s = await recentOwnerRequest(req);
  if (!s) return NextResponse.json({ error: "Reauthenticate in Trading control before changing custody settings" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as any;
  const { agentId, asset, amount } = b;
  const chain = (b.chain || "base").toLowerCase();
  if (!agentId || !asset || !(Number(amount) > 0)) return NextResponse.json({ error: "agentId, asset, amount required" }, { status: 400 });

  const k = await loadKeysetPublic(s.userId, agentId);
  if (!k) return NextResponse.json({ error: "No on-chain wallet for this agent." }, { status: 400 });
  if (!k.ownerAddress) return NextResponse.json({ error: "Set a withdrawal address first." }, { status: 400 });
  if (!CHAINS[chain]) return NextResponse.json({ error: `Unsupported chain "${chain}"` }, { status: 400 });

  try {
    const from = k.evmAddress as Address, to = k.ownerAddress as Address;
    const native = String(asset).toUpperCase() === "ETH";
    let tx;
    if (native) {
      tx = await buildWithdrawTx(chain, from, to, { native: true, amount: parseUnits(String(amount), 18) });
    } else {
      const token = resolveToken(chain, asset); // 'usdc' or a 0x contract
      const dec = await getDecimals(chain, token);
      tx = await buildWithdrawTx(chain, from, to, { token, amount: parseUnits(String(amount), dec) });
    }
    const signed = await rootSignEvmTx(k.subOrgId, from, serializeTransaction(tx as any));
    const hash = await broadcast(chain, signed);
    return NextResponse.json({ ok: true, txHash: hash, to, chain });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Withdraw failed" }, { status: 200 });
  }
}
