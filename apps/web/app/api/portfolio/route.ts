import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { loadKeysetPublic } from "../../../lib/server/turnkey-sql";
import { loadHlPublic } from "../../../lib/server/hl-sql";
import { nativeBalance, tokenBalance, CHAINS } from "../../../lib/server/dex";
import { getAccount, getUserFills, markPrice } from "../../../lib/server/hyperliquid";

export const runtime = "nodejs";
export const maxDuration = 40;

// Aggregate portfolio + performance across all of a user's agents:
// on-chain (Base) wallet value + Hyperliquid equity, open positions, realized PnL.
export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const ag = await query<any>("SELECT id, name FROM agents WHERE user_id=$1 ORDER BY created_at ASC", [s.userId]);
  const ethPx = await markPrice("ETH", "mainnet").catch(() => null);

  const rows = await Promise.all((ag.rows ?? []).map(async (a: any) => {
    let onchainUsd: number|null = null, hlEquity: number|null = null, openPositions: number|null = null, realizedPnl: number|null = null, hasWallet = false, hasHl = false;
    try {
      const k = await loadKeysetPublic(s.userId, a.id);
      if (k) {
        hasWallet = true;
        const [ethWei, usdcRaw] = await Promise.all([
          nativeBalance("base", k.evmAddress as `0x${string}`),
          tokenBalance("base", CHAINS.base.usdc as `0x${string}`, k.evmAddress as `0x${string}`),
        ]);
        onchainUsd = ethPx ? Number(usdcRaw) / 1e6 + Number(ethWei)/1e18*ethPx : null;
      }
    } catch {}
    try {
      const hl = await loadHlPublic(s.userId, a.id);
      if (hl) {
        hasHl = true;
        const acct = await getAccount(hl.address, hl.network);
        hlEquity = acct.equity; openPositions = acct.openPositions;
        const f = await getUserFills(hl.address, hl.network).catch(() => null);
        realizedPnl = f?.realizedPnl ?? null;
      }
    } catch {}
    return { id: a.id, name: a.name, valueUsd: null, coreValueUsd:onchainUsd!==null ? Math.round((onchainUsd+(hlEquity??0))*100)/100:null, onchainUsd: onchainUsd===null?null:Math.round(onchainUsd * 100) / 100, hlEquity, openPositions, realizedPnl, hasWallet, hasHl };
  }));

  return NextResponse.json({
    totalValueUsd: null, coverage:"Partial: Base ETH/USDC and Hyperliquid only; other chains/assets and complete realized PnL unavailable",
    totalRealizedPnl: null,
    openPositions: rows.every(r=>r.openPositions!==null)?rows.reduce((a,r)=>a+(r.openPositions??0),0):null,
    agents: rows,
  });
}
