"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { Icon } from "../components/Icon";

const PRESETS = [
  { id: "ema", name: "EMA 20/50 cross", d: "Trend-following moving-average crossover" },
  { id: "rsi", name: "RSI reversion", d: "Buy oversold (<30), exit into strength" },
  { id: "donchian", name: "Donchian breakout", d: "20-bar channel breakout" },
  { id: "macd", name: "MACD cross", d: "MACD line crosses its signal" },
];

export default function BacktestPage() {
  const ready = useAuth();
  const [mode, setMode] = useState<"agent" | "preset">("agent");
  const [agents, setAgents] = useState<any[]>([]);
  const [agentId, setAgentId] = useState("");
  const [symbol, setSymbol] = useState("BTC");
  const [interval, setInterval] = useState("1d");
  const [years, setYears] = useState(3);
  const [preset, setPreset] = useState("ema");
  const [direction, setDirection] = useState("long");
  const [riskPct, setRiskPct] = useState(1);
  const [onchain, setOnchain] = useState(false);
  const [network, setNetwork] = useState("base");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { if (ready) api.agents.list().then((a) => { setAgents(a.agents || []); if (a.agents?.[0]) setAgentId(a.agents[0].id); }).catch(() => {}); }, [ready]);
  if (!ready) return null;

  async function run() {
    setBusy(true); setErr(null); setRes(null);
    try {
      let body: Record<string, unknown>;
      if (mode === "agent") {
        if (!agentId) { setErr("Pick an agent."); setBusy(false); return; }
        body = { agentId, interval, years, riskPct };
      } else {
        body = { symbol, interval, years, preset, direction, riskPct };
        if (onchain && address) { body.network = network; body.address = address.trim(); }
      }
      const r = await api.backtest(body);
      if (r.error) setErr(r.error); else setRes(r.result);
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  return (
    <main className="container" style={{ paddingTop: 28, paddingBottom: 90, maxWidth: 1000 }}>
      <h1 style={{ marginBottom: 4 }}>Backtest</h1>
      <p className="text-2" style={{ marginBottom: 22, fontSize: 14.5 }}>Stress-test a strategy over real history — fees, slippage, stops, no lookahead. Crypto perps, or any on-chain token by contract.</p>

      <div className="grid-auto" style={{ display: "grid", gridTemplateColumns: "360px 1fr", gap: 18, alignItems: "start" }}>
        {/* Form */}
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", gap: 6, background: "var(--surface-2)", padding: 4, borderRadius: 12 }}>
            {(["agent", "preset"] as const).map((m) => (
              <button key={m} onClick={() => { setMode(m); setRes(null); setErr(null); }} style={{ flex: 1, padding: "8px 0", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 650, fontSize: 13, background: mode === m ? "var(--brand)" : "transparent", color: mode === m ? "var(--on-brand)" : "var(--text-2)" }}>
                {m === "agent" ? "Agent's strategy" : "Preset"}
              </button>
            ))}
          </div>

          {mode === "agent" ? (
            <div>
              <label className="label">Agent</label>
              {agents.length === 0 ? (
                <p className="muted" style={{ fontSize: 13 }}>No agents yet. Create one, give it a strategy, then test it here.</p>
              ) : (
                <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              )}
              <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>Runs this agent&apos;s active strategy — its stored rules, or compiled from its thesis. Symbol comes from the strategy; set the window below.</p>
            </div>
          ) : (<>
          <div>
            <label className="label">Strategy</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {PRESETS.map((p) => (
                <button key={p.id} onClick={() => setPreset(p.id)} className="card-flat" style={{ textAlign: "left", padding: "10px 12px", cursor: "pointer", border: `1px solid ${preset === p.id ? "var(--brand)" : "var(--border)"}`, background: preset === p.id ? "var(--brand-soft)" : "var(--surface-2)" }}>
                  <div style={{ fontWeight: 650, fontSize: 13.5, color: preset === p.id ? "var(--brand)" : "var(--text)" }}>{p.name}</div>
                  <div className="muted" style={{ fontSize: 12 }}>{p.d}</div>
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <label className="label" style={{ margin: 0 }}>On-chain token</label>
            <button onClick={() => setOnchain((v) => !v)} className={`badge ${onchain ? "badge-brand" : "badge-soft"}`} style={{ height: 24, cursor: "pointer", border: "none" }}>{onchain ? "ON" : "OFF"}</button>
          </div>

          {onchain ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div>
                <label className="label">Network</label>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["base", "solana", "arbitrum", "eth", "robinhood"].map((n) => <span key={n} className={`chip${network === n ? " on" : ""}`} onClick={() => setNetwork(n)} style={{ cursor: "pointer", padding: "5px 10px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${network === n ? "var(--brand)" : "var(--border)"}`, color: network === n ? "var(--brand)" : "var(--text-2)" }}>{n}</span>)}</div>
              </div>
              <div><label className="label">Token contract</label><input className="input mono" placeholder="0x…" value={address} onChange={(e) => setAddress(e.target.value)} /></div>
              <div><label className="label">Label</label><input className="input" placeholder="e.g. DEGEN" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
            </div>
          ) : (
            <div><label className="label">Symbol</label><input className="input mono" placeholder="BTC, ETH, SOL…" value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} /></div>
          )}
          </>)}

          <div className="grid-auto" style={{ display: "grid", gridTemplateColumns: mode === "agent" ? "1fr" : "1fr 1fr", gap: 10 }}>
            <div>
              <label className="label">Interval</label>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{["15m", "1h", "4h", "1d"].map((iv) => <span key={iv} onClick={() => setInterval(iv)} style={{ cursor: "pointer", padding: "5px 9px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${interval === iv ? "var(--brand)" : "var(--border)"}`, color: interval === iv ? "var(--brand)" : "var(--text-2)" }}>{iv}</span>)}</div>
            </div>
            {mode !== "agent" && (
            <div>
              <label className="label">Direction</label>
              <div style={{ display: "flex", gap: 6 }}>{["long", "short", "both"].map((d) => <span key={d} onClick={() => setDirection(d)} style={{ cursor: "pointer", padding: "5px 9px", borderRadius: 8, fontSize: 12.5, border: `1px solid ${direction === d ? "var(--brand)" : "var(--border)"}`, color: direction === d ? "var(--brand)" : "var(--text-2)" }}>{d}</span>)}</div>
            </div>
            )}
          </div>

          <div className="grid-auto" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label className="label">Years</label><input className="input" type="number" min={0.25} max={10} step={0.25} value={years} onChange={(e) => setYears(Number(e.target.value))} /></div>
            <div><label className="label">Risk % / trade</label><input className="input" type="number" min={0.1} max={5} step={0.1} value={riskPct} onChange={(e) => setRiskPct(Number(e.target.value))} /></div>
          </div>

          <button className="btn btn-solid" onClick={run} disabled={busy} style={{ marginTop: 4 }}>{busy ? "Running…" : "Run backtest"}</button>
          {err && <p style={{ color: "var(--red)", fontSize: 13 }}>{err}</p>}
        </div>

        {/* Results */}
        <div className="card" style={{ minHeight: 320, display: "flex", flexDirection: "column" }}>
          {!res ? (
            <div className="muted" style={{ margin: "auto", textAlign: "center", padding: 30 }}>
              <Icon name="chart" size={30} /><div style={{ marginTop: 10, fontSize: 14 }}>{busy ? "Crunching history…" : "Run a backtest to see results"}</div>
            </div>
          ) : (
            <Results r={res} />
          )}
        </div>
      </div>
    </main>
  );
}

function Results({ r }: { r: any }) {
  const money = (v: any) => v == null ? "—" : `${v > 0 ? "+" : ""}${Number(v).toFixed(1)}%`;
  const stats: [string, string, boolean?][] = [
    ["Total return", money(r.totalReturnPct), r.totalReturnPct >= 0],
    ["CAGR", r.cagrPct == null ? "—" : money(r.cagrPct), (r.cagrPct ?? 0) >= 0],
    ["Sharpe", r.sharpe == null ? "—" : String(r.sharpe), (r.sharpe ?? 0) >= 1],
    ["Max drawdown", `-${r.maxDrawdownPct}%`, false],
    ["Win rate", r.winRatePct == null ? "—" : `${r.winRatePct}%`],
    ["Profit factor", r.profitFactor == null ? "—" : String(r.profitFactor), (r.profitFactor ?? 0) >= 1],
    ["Trades", String(r.trades)],
    ["Avg R", r.avgR == null ? "—" : String(r.avgR)],
  ];
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8, marginBottom: 6 }}>
        <div className="display" style={{ fontWeight: 700, fontSize: 18 }}>{r.symbol} · {r.interval}</div>
        <span className="badge badge-soft mono" style={{ height: 22 }}>{r.dataSource} · {r.preset}</span>
      </div>
      <div className="muted mono" style={{ fontSize: 12, marginBottom: 14 }}>{r.from} → {r.to} · {r.bars} bars</div>
      <Equity curve={r.equityCurve} up={(r.totalReturnPct ?? 0) >= 0} />
      <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 18 }}>
        {stats.map(([k, v, good]) => (
          <div key={k}>
            <div className="muted" style={{ fontSize: 11 }}>{k}</div>
            <div className="display" style={{ fontWeight: 700, fontSize: 17, color: good === undefined ? "var(--text)" : good ? "var(--green)" : "var(--red)" }}>{v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Equity({ curve, up }: { curve: number[]; up: boolean }) {
  if (!curve || curve.length < 2) return null;
  const W = 640, H = 180, pad = 4;
  const min = Math.min(...curve), max = Math.max(...curve), span = max - min || 1;
  const pts = curve.map((v, i) => {
    const x = pad + (i / (curve.length - 1)) * (W - pad * 2);
    const y = pad + (1 - (v - min) / span) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const stroke = up ? "var(--green)" : "var(--red)";
  return (
    <div className="scroll-x" style={{ borderRadius: 12, border: "1px solid var(--border)", background: "var(--surface-2)", padding: 8 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={pts} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" />
      </svg>
    </div>
  );
}
