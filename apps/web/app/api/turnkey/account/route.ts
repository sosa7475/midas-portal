import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { loadKeysetPublic } from "../../../../lib/server/turnkey-sql";
import { nativeBalance, tokenBalance, CHAINS } from "../../../../lib/server/dex";
import { markPrice } from "../../../../lib/server/hyperliquid";

export const runtime = "nodejs";

// On-chain wallet info for an agent: the Base trade-only address, owner (withdrawal) address,
// live ETH + USDC balances, and their USD value. Base is the primary trading chain.
export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) return NextResponse.json({ error: "agentId required" }, { status: 400 });
  const k = await loadKeysetPublic(s.userId, agentId);
  if (!k) return NextResponse.json({ connected: false });

  const evm = k.evmAddress as `0x${string}`;
  let balances: any = null, valueUsd:number|null = null;
  try {
    const [ethWei, usdcRaw, ethPx] = await Promise.all([
      nativeBalance("base", evm),
      tokenBalance("base", CHAINS.base.usdc as `0x${string}`, evm),
      markPrice("ETH", "mainnet").catch(() => null),
    ]);
    const eth = Number(ethWei) / 1e18, usdc = Number(usdcRaw) / 1e6;
    valueUsd = ethPx?Math.round((usdc+eth*ethPx)*100)/100:null;
    balances = { eth: Math.round(eth * 1e6) / 1e6, usdc: Math.round(usdc * 100) / 100, ethUsd: ethPx || null };
  } catch { /* balances best-effort */ }

  return NextResponse.json({ connected: true, evmAddress: k.evmAddress, solAddress: k.solAddress, ownerAddress: k.ownerAddress, network: "base", balances, coreValueUsd:valueUsd, valueUsd:null, coverage:"Partial: Base ETH/USDC only. Use Trading control for chain-specific holdings." });
}
