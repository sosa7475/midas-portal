"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";

export default function Overview() {
  const ready = useAuth();
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => { if (ready) api.agents.list().then((r) => setAgents(r.agents)).catch(() => {}); }, [ready]);
  if (!ready) return null;

  const stats = [
    { label: "Agents", value: agents.length, href: "/agents" },
    { label: "Exchange", value: "Orderly", href: "/wallet" },
    { label: "Open positions", value: "—", href: "/wallet" },
    { label: "30d Sharpe", value: "—", href: "/wallet" },
  ];

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80 }}>
      <h1 style={{ marginBottom: 4 }}>Overview</h1>
      <p className="text-2" style={{ marginBottom: 26 }}>Your agents and trading at a glance.</p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 14, marginBottom: 28 }}>
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card-flat">
            <div className="muted" style={{ fontSize: 13 }}>{s.label}</div>
            <div style={{ fontSize: 26, fontWeight: 700, marginTop: 4 }}>{s.value}</div>
          </Link>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 16 }}>
        <div className="card">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h2>Your agents</h2>
            <Link href="/agents/new" className="btn btn-outline btn-sm">+ New</Link>
          </div>
          {agents.length === 0 ? (
            <p className="text-2">No agents yet. <Link href="/agents/new" style={{ color: "var(--brand)" }}>Create your first agent →</Link></p>
          ) : agents.slice(0, 5).map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, background: "linear-gradient(135deg,#e2622f,#f2913f)", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{a.name.slice(0, 1).toUpperCase()}</span>
              <span style={{ fontWeight: 600, flex: 1 }}>{a.name}</span>
              <span className="muted">›</span>
            </Link>
          ))}
        </div>
        <div className="card">
          <h2 style={{ marginBottom: 10 }}>Get started</h2>
          <ol className="text-2" style={{ paddingLeft: 18, display: "flex", flexDirection: "column", gap: 10, fontSize: 14 }}>
            <li><Link href="/agents/new" style={{ color: "var(--brand)", fontWeight: 600 }}>Create an agent</Link> with your strategy</li>
            <li>Connect its MCPs (TA, DeFiLlama, on-chain)</li>
            <li><Link href="/wallet" style={{ color: "var(--brand)", fontWeight: 600 }}>Connect Orderly</Link> to trade & track performance</li>
            <li>Chat with your agent and act on its calls</li>
          </ol>
        </div>
      </div>
    </main>
  );
}
