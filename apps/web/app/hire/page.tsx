"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";

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
    name: "Strategy Backtester",
    blurb: "Backtests your strategy over years of real history — Sharpe, drawdown, win rate, equity curve.",
    mcps: ["technical-analysis"],
    instructions: "# Strategy Backtester\nWhen the user describes a strategy (or names one of their agents'), translate it into backtest_strategy parameters and run it over several years of history. Report Sharpe, max drawdown, win rate, CAGR, profit factor, and # trades. Then suggest concrete parameter tweaks (trend filter, RSI thresholds, ATR stop, R target, risk %) to improve risk-adjusted return. Be quantitative and honest about overfitting.",
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
    <main className="container" style={{ paddingTop: 22, paddingBottom: 60 }}>
      <h1 style={{ marginBottom: 16 }}>Hire an Agent</h1>

      <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
        {TEMPLATES.map((t) => (
          <div key={t.name} className="card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
            <div style={{ fontWeight: 650, fontSize: 15 }}>{t.name}</div>
            <div className="text-2" style={{ fontSize: 13, lineHeight: 1.45, flex: 1, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{t.blurb}</div>
            <button className="btn btn-solid btn-sm" onClick={() => hire(t)} disabled={busy === t.name} style={{ width: "100%" }}>{busy === t.name ? "Adding…" : "Hire"}</button>
          </div>
        ))}
      </div>
    </main>
  );
}
