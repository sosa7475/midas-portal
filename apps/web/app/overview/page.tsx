"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";

export default function Overview() {
  const ready = useAuth();
  const [agents, setAgents] = useState<any[]>([]);
  const [pf, setPf] = useState<any>(null);

  useEffect(() => {
    if (!ready) return;
    api.agents.list().then((r) => setAgents(r.agents)).catch(() => {});
    api.portfolio().then(setPf).catch(() => {});
  }, [ready]);
  if (!ready) return null;

  const money = (v: any) => v == null ? "—" : `$${Number(v).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
  const pnl = pf?.totalRealizedPnl;
  const stats = [
    { label: "Portfolio value", value: pf ? money(pf.totalValueUsd) : "…", href: "/wallet" },
    { label: "Realized PnL", value: pf ? pnl==null?"Unavailable":`${pnl >= 0 ? "+" : ""}${money(pnl).slice(1) ? money(pnl) : "$0"}` : "…", href: "/wallet", color: pnl == null ? undefined : pnl >= 0 ? "var(--green)" : "var(--red)" },
    { label: "Open positions", value: pf ? pf.openPositions==null?"Unavailable":String(pf.openPositions) : "…", href: "/wallet" },
    { label: "Agents", value: agents.length, href: "/agents" },
  ];

  return (
    <main className="container" style={{ paddingTop: 22, paddingBottom: 60 }}>
      <h1 style={{ marginBottom: 16 }}>Overview</h1>

      <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 22 }}>
        {stats.map((s) => (
          <Link key={s.label} href={s.href} className="card-flat" style={{ padding: "14px 16px" }}>
            <div className="muted" style={{ fontSize: 12.5 }}>{s.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 3, color: (s as any).color }}>{s.value}</div>
          </Link>
        ))}
      </div>

      <div className="card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h2>Your agents</h2>
          <Link href="/agents/new" className="btn btn-outline btn-sm">+ New</Link>
        </div>
        {agents.length === 0 ? (
          <p className="text-2">No agents yet. <Link href="/agents/new" style={{ color: "var(--brand)" }}>Create your first agent →</Link></p>
        ) : agents.slice(0, 8).map((a) => (
          <Link key={a.id} href={`/agents/${a.id}`} style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0", borderBottom: "1px solid var(--border)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--brand)", color: "var(--on-brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 13 }}>{a.name.slice(0, 1).toUpperCase()}</span>
            <span style={{ fontWeight: 600, flex: 1 }}>{a.name}</span>
            <span className="muted">›</span>
          </Link>
        ))}
      </div>
    </main>
  );
}
