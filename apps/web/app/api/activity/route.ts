import { NextRequest, NextResponse } from "next/server";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { loadHlPublic } from "../../../lib/server/hl-sql";
import { loadKeysetPublic } from "../../../lib/server/turnkey-sql";
import { getAccount, markPrice } from "../../../lib/server/hyperliquid";
import { getActiveStrategy } from "../../../lib/server/strategy-sql";
import { nativeBalance, tokenBalance, getDecimals, resolveToken, CHAINS } from "../../../lib/server/dex";
import { gtToken } from "../../../lib/server/geckoterminal";

export const runtime = "nodejs";
export const maxDuration = 40;

// Open positions (Hyperliquid perps) + trade history (from the per-agent performance ledger),
// each trade carrying the strategy version whose thesis produced it.
export async function GET(req: NextRequest) {
  const s = await getSession(req);
  if (!s) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const ag = await query<any>("SELECT id, name FROM agents WHERE user_id=$1", [s.userId]);
  const nameById: Record<string, string> = {};
  for (const a of ag.rows) nameById[a.id] = a.name;

  // Open perp positions across agents.
  const positions: any[] = [];
  await Promise.all(ag.rows.map(async (a: any) => {
    try {
      const hl = await loadHlPublic(s.userId, a.id);
      if (!hl) return;
      const acct = await getAccount(hl.address, hl.network);
      for (const p of acct.positions) positions.push({ agent: a.name, agentId: a.id, ...p });
    } catch {}
  }));

  // Trade history from the ledger.
  const tr = await query<any>(
    `SELECT p.created_at, p.strategy_version, p.metrics, p.agent_id
     FROM agent_perf p WHERE p.user_id=$1 AND p.kind='trade' ORDER BY p.created_at DESC LIMIT 60`,
    [s.userId]
  );
  // Attach each agent's active strategy thesis as the "rationale" context.
  const thesisByAgent: Record<string, string> = {};
  await Promise.all([...new Set(tr.rows.map((r: any) => r.agent_id))].map(async (aid: any) => {
    try { const st = await getActiveStrategy(s.userId, aid); if (st?.thesis) thesisByAgent[aid] = st.thesis; } catch {}
  }));
  const trades = tr.rows.map((r: any) => {
    const m = r.metrics || {};
    const swap = m.venue === "uniswap";
    const price = swap && m.amountIn && m.amountOut ? Number(m.amountOut) / Number(m.amountIn) : (m.avgPx ?? null);
    return {
      at: r.created_at, agent: nameById[r.agent_id] ?? "agent", agentId: r.agent_id, strategyVersion: r.strategy_version,
      kind: swap ? "swap" : "perp", chain: m.chain ?? null, venue: m.venue ?? (m.network ? "hyperliquid" : null),
      summary: swap ? `${m.amountIn} ${String(m.tokenIn).toUpperCase()} → ~${m.amountOut ?? "?"} ${String(m.tokenOut).toUpperCase()}` : `${String(m.side).toUpperCase()} ${m.quantity} ${m.symbol}`,
      price, notionalUsd: m.notionalUsd ?? null, txHash: m.swapTx ?? null, oid: m.oid ?? null,
      rationale: thesisByAgent[r.agent_id] ? String(thesisByAgent[r.agent_id]).slice(0, 240) : null,
    };
  });

  // Spot holdings — the assets you're actually in. Derived from tokens this agent has traded
  // (+ USDC/ETH), read live on-chain and priced via GeckoTerminal. No general indexer needed.
  const USDC = CHAINS.base.usdc!.toLowerCase();
  const holdings: any[] = [];
  await Promise.all(ag.rows.map(async (a: any) => {
    try {
      const k = await loadKeysetPublic(s.userId, a.id);
      if (!k) return;
      const evm = k.evmAddress as `0x${string}`;
      const addrs = new Set<string>([USDC]);
      for (const r of tr.rows.filter((x: any) => x.agent_id === a.id)) {
        const m = r.metrics || {};
        // Prefer the resolved contract addresses stored on the trade; fall back to resolving the symbol.
        for (const ad0 of [m.tokenOutAddr, m.tokenInAddr]) { if (ad0 && /^0x[0-9a-f]{40}$/i.test(ad0) && ad0.toLowerCase() !== CHAINS.base.wnative.toLowerCase()) addrs.add(ad0.toLowerCase()); }
        for (const sym of [m.tokenOut, m.tokenIn]) {
          if (!sym) continue;
          try { const ad = resolveToken("base", String(sym)).toLowerCase(); if (ad !== CHAINS.base.wnative.toLowerCase()) addrs.add(ad); } catch {}
        }
      }
      // native ETH
      const [ethWei, ethPx] = await Promise.all([nativeBalance("base", evm).catch(() => 0n), markPrice("ETH", "mainnet").catch(() => null)]);
      const eth = Number(ethWei) / 1e18;
      if (eth * (ethPx || 0) >= 0.01) holdings.push({ agent: a.name, symbol: "ETH", amount: Math.round(eth * 1e6) / 1e6, priceUsd: ethPx, valueUsd: Math.round(eth * (ethPx || 0) * 100) / 100 });
      // ERC20s
      for (const addr of addrs) {
        try {
          const [balRaw, dec] = await Promise.all([tokenBalance("base", addr as `0x${string}`, evm).catch(() => 0n), getDecimals("base", addr as `0x${string}`).catch(() => 18)]);
          const amt = Number(balRaw) / 10 ** dec;
          if (amt <= 0) continue; // no balance → not a holding
          const meta = addr === USDC ? { symbol: "USDC", priceUsd: 1 } : await gtToken("base", addr).catch(() => null);
          const px = meta?.priceUsd ?? null; // keep the holding even if price lookup fails
          const val = px != null ? amt * px : null;
          if (val != null && val < 0.01) continue; // dust
          holdings.push({ agent: a.name, symbol: meta?.symbol ?? `${addr.slice(0, 6)}…`, address: addr, amount: Math.round(amt * 1e6) / 1e6, priceUsd: px, valueUsd: val != null ? Math.round(val * 100) / 100 : null });
        } catch {}
      }
    } catch {}
  }));
  holdings.sort((x, y) => y.valueUsd - x.valueUsd);
  const spotValue = holdings.reduce((a, h) => a + (h.valueUsd || 0), 0);
  const perpEquity = positions.reduce((a, p) => a + (p.value || 0), 0);
  const totalValueUsd = Math.round((spotValue + perpEquity) * 100) / 100;
  for (const h of holdings) h.allocationPct = spotValue > 0 && h.valueUsd != null ? Math.round((h.valueUsd / spotValue) * 1000) / 10 : null;

  return NextResponse.json({ holdings, positions, trades, totalValueUsd });
}
