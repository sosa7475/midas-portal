"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { mcpById } from "../../lib/mcps";
import { Icon } from "../components/Icon";

const TEMPLATES = [
  {
    name: "Momentum Scalper",
    blurb: "Rides intraday momentum on high-liquidity perps with tight ATR stops.",
    mcps: ["technical-analysis", "orderly"],
    instructions: "# Momentum Scalper\nTrade only with the 1h/4h trend. Enter on pullbacks to EMA20 with RSI reset. Risk 0.5% per trade, ATR(1.5) stops, 2R targets. Avoid extreme funding. Be fast and decisive.",
  },
  {
    name: "Swing Strategist",
    blurb: "Higher-timeframe swings using structure, funding, and open interest.",
    mcps: ["technical-analysis", "orderly"],
    instructions: "# Swing Strategist\nUse the daily trend + 4h structure. Enter at support/resistance confluence. Risk 1%, wide ATR stops, scale out at 2R/3R. Prefer positive-carry positioning (funding).",
  },
  {
    name: "DeFi Yield Hunter",
    blurb: "Finds the best risk-adjusted yields and rotates across protocols.",
    mcps: ["defillama"],
    instructions: "# DeFi Yield Hunter\nSurface top APYs with TVL > $5M and low risk. Compare protocols, flag depeg/rug risk, and recommend allocations. Explain the yield source.",
  },
  {
    name: "On-chain Sentinel",
    blurb: "Tracks smart money, holder concentration, and unusual flows.",
    mcps: ["moralis", "technical-analysis"],
    instructions: "# On-chain Sentinel\nWatch whale movements and holder concentration. Correlate on-chain flow with price/TA. Warn on distribution; highlight accumulation.",
  },
];

export default function Hire() {
  const ready = useAuth();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  if (!ready) return null;

  async function hire(t: (typeof TEMPLATES)[number]) {
    setBusy(t.name);
    try {
      const { agent } = await api.agents.create({ name: t.name, instructions: t.instructions, mcps: t.mcps });
      router.push(`/agents/${agent.id}`);
    } catch { setBusy(null); }
  }

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80 }}>
      <h1 style={{ marginBottom: 4 }}>Hire an Agent</h1>
      <p className="text-2" style={{ marginBottom: 26 }}>Start from a proven template — it&apos;s added to your agents, fully editable.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {TEMPLATES.map((t) => (
          <div key={t.name} className="card" style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontWeight: 650, fontSize: 16, marginBottom: 6 }}>{t.name}</div>
            <div className="text-2" style={{ fontSize: 14, flex: 1 }}>{t.blurb}</div>
            <div style={{ display: "flex", gap: 6, margin: "14px 0", flexWrap: "wrap" }}>
              {t.mcps.map((id) => <span key={id} className="badge badge-soft"><Icon name={mcpById(id)?.icon ?? "spark"} size={12} /> {mcpById(id)?.name}</span>)}
            </div>
            <button className="btn btn-solid btn-sm" onClick={() => hire(t)} disabled={busy === t.name}>{busy === t.name ? "Adding…" : "Hire this agent"}</button>
          </div>
        ))}
      </div>
    </main>
  );
}
