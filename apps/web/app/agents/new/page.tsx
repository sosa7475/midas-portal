"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import { MCPS } from "../../../lib/mcps";
import { Icon } from "../../components/Icon";

const TEMPLATE = `# Strategy
Describe how this agent should trade in plain English.

## Rules
- Only take trades that align with the higher-timeframe trend
- Risk 1% of equity per trade
- Stops based on ATR (1.5x), take-profit at 2R minimum
- Skip setups when funding is extreme (> 0.05%)

## Voice
- Be direct and disciplined. Flag when an idea breaks the rules.`;

export default function NewAgent() {
  const ready = useAuth();
  const router = useRouter();
  const [name, setName] = useState("");
  const [instructions, setInstructions] = useState(TEMPLATE);
  const [mcps, setMcps] = useState<string[]>(["technical-analysis"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!ready) return null;

  function toggle(id: string) {
    setMcps((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  }

  async function create() {
    if (!name.trim()) { setError("Give your agent a name."); return; }
    setBusy(true); setError(null);
    try {
      const { agent } = await api.agents.create({ name, instructions, mcps });
      router.push(`/agents/${agent.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create agent");
      setBusy(false);
    }
  }

  return (
    <main className="container" style={{ maxWidth: 760, paddingTop: 34, paddingBottom: 80 }}>
      <h1 style={{ marginBottom: 6 }}>Create an agent</h1>
      <p className="text-2" style={{ marginBottom: 28 }}>Give it a name, write its strategy, and connect the tools it can use.</p>

      <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
        <div>
          <label className="label">Agent name</label>
          <input className="input" placeholder="e.g. Momentum Scalper" value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        <div>
          <label className="label">Strategy & instructions <span className="muted">— this is the agent&apos;s brain (its .md)</span></label>
          <textarea className="textarea mono" style={{ minHeight: 240, fontSize: 13.5 }} value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </div>

        <div>
          <label className="label">Connect trading MCPs</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            {MCPS.map((m) => {
              const on = mcps.includes(m.id);
              return (
                <div key={m.id} onClick={() => toggle(m.id)} className="card-flat" style={{ padding: 16, cursor: "pointer", borderColor: on ? "var(--brand)" : "var(--border)", background: on ? "var(--brand-soft)" : "var(--surface)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
                    <span style={{ color: on ? "var(--brand)" : "var(--text-2)" }}><Icon name={m.icon} size={19} /></span>
                    <span style={{ fontWeight: 650, flex: 1 }}>{m.name}</span>
                    <span style={{ width: 18, height: 18, borderRadius: 999, border: `2px solid ${on ? "var(--brand)" : "var(--border-strong)"}`, background: on ? "var(--brand)" : "transparent", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 11 }}>{on ? "✓" : ""}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 13 }}>{m.description}</div>
                  <div style={{ marginTop: 8 }}><span className={`badge ${m.ready ? "badge-on" : "badge-soft"}`}>{m.status}</span></div>
                </div>
              );
            })}
          </div>
        </div>

        {error && <p style={{ color: "var(--red)", fontSize: 14 }}>{error}</p>}
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-solid" disabled={busy} onClick={create}>{busy ? "Creating…" : "Create agent"}</button>
          <button className="btn btn-ghost" onClick={() => router.push("/agents")}>Cancel</button>
        </div>
      </div>
    </main>
  );
}
