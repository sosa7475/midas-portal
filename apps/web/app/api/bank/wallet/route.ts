import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../../lib/server/auth";
import { loadUserWallet, saveUserWallet } from "../../../../lib/server/user-wallet-sql";
import { provisionPersonalWallet, turnkeyReady } from "../../../../lib/server/turnkey";
import { nativeBalance, tokenBalance, CHAINS } from "../../../../lib/server/dex";
import { markPrice } from "../../../../lib/server/hyperliquid";

export const runtime = "nodejs";
export const maxDuration = 30;

async function balances(evm: string) {
  const [ethWei, usdcRaw, ethPx] = await Promise.all([
    nativeBalance("base", evm as `0x${string}`).catch(() => 0n),
    tokenBalance("base", CHAINS.base.usdc as `0x${string}`, evm as `0x${string}`).catch(() => 0n),
    markPrice("ETH", "mainnet").catch(() => null),
  ]);
  const eth = Number(ethWei) / 1e18, usdc = Number(usdcRaw) / 1e6;
  return { eth: Math.round(eth * 1e6) / 1e6, usdc: Math.round(usdc * 100) / 100, valueUsd: Math.round((usdc + (ethPx ? eth * ethPx : 0)) * 100) / 100, ethPrice: ethPx };
}

export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  let w = await loadUserWallet(s.userId);
  if (!w) {
    if (!turnkeyReady()) return NextResponse.json({ error: "Wallet service not configured." }, { status: 400 });
    const p = await provisionPersonalWallet(`bank-${s.userId.slice(0, 8)}`);
    await saveUserWallet(s.userId, p);
    w = p;
  }
  return NextResponse.json({ evmAddress: w.evmAddress, solAddress: w.solAddress, ...(await balances(w.evmAddress)) });
}
