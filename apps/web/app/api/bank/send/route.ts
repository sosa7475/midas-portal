import {recentOwnerRequest} from "../../../../lib/server/owner-request";
import { NextRequest, NextResponse } from "next/server";
import { serializeTransaction, parseUnits, type Address } from "viem";
import { getSession } from "../../../../lib/server/auth";
import { loadUserWallet } from "../../../../lib/server/user-wallet-sql";
import { rootSignEvmTx } from "../../../../lib/server/turnkey";
import { buildWithdrawTx, broadcast, resolveToken, getDecimals, CHAINS } from "../../../../lib/server/dex";

export const runtime = "nodejs";
export const maxDuration = 30;

/** Send USDC or ETH from the user's personal Bank wallet to any address. Session-gated; root-signed. */
export async function POST(req: NextRequest) {
  const s = await recentOwnerRequest(req);
  if (!s) return NextResponse.json({ error: "Reauthenticate in Trading control before changing custody settings" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as any;
  const { to, asset, amount } = b;
  const chain = (b.chain || "base").toLowerCase();
  if (!to || !/^0x[0-9a-fA-F]{40}$/.test(String(to))) return NextResponse.json({ error: "A valid 0x recipient address is required." }, { status: 400 });
  if (!asset || !(Number(amount) > 0)) return NextResponse.json({ error: "asset and amount required" }, { status: 400 });
  if (!CHAINS[chain]) return NextResponse.json({ error: `Unsupported chain "${chain}"` }, { status: 400 });

  const w = await loadUserWallet(s.userId);
  if (!w) return NextResponse.json({ error: "No Bank wallet yet." }, { status: 400 });

  try {
    const from = w.evmAddress as Address, dest = to as Address;
    const native = String(asset).toUpperCase() === "ETH";
    let tx;
    if (native) tx = await buildWithdrawTx(chain, from, dest, { native: true, amount: parseUnits(String(amount), 18) });
    else { const token = resolveToken(chain, asset); const dec = await getDecimals(chain, token); tx = await buildWithdrawTx(chain, from, dest, { token, amount: parseUnits(String(amount), dec) }); }
    const signed = await rootSignEvmTx(w.subOrgId, from, serializeTransaction(tx as any));
    const hash = await broadcast(chain, signed);
    return NextResponse.json({ ok: true, txHash: hash, to: dest, chain });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 200 });
  }
}
