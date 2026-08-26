"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { mcpById } from "../../lib/mcps";
import { Icon } from "../components/Icon";

export default function MyAgents() {
  const ready = useAuth();
  const [agents, setAgents] = useState<any[] | null>(null);

  useEffect(() => {
    if (ready) api.agents.list().then((r) => setAgents(r.agents)).catch(() => setAgents([]));
  }, [ready]);

  if (!ready) return null;

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
        <div>
          <h1>My Agents</h1>
          <p className="text-2">Your trading agents, each with its own strategy and connected tools.</p>
        </div>
        <Link href="/agents/new" className="btn btn-solid">+ New Agent</Link>
      </div>

      {agents === null ? (
        <p className="muted">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ width: 52, height: 52, borderRadius: 14, margin: "0 auto 14px", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--brand-soft)", color: "var(--brand)", border: "1px solid var(--brand-ring)" }}><Icon name="agents" size={26} /></div>
          <h2 style={{ marginBottom: 8 }}>No agents yet</h2>
          <p className="text-2" style={{ marginBottom: 20 }}>Create your first trading agent — give it a strategy and connect its tools.</p>
          <Link href="/agents/new" className="btn btn-solid">Create an agent</Link>
        </div>
      ) : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 }}>
          {agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="card" style={{ display: "block" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
                <span style={{ width: 40, height: 40, borderRadius: 10, background: "linear-gradient(135deg,#e2622f,#f2913f)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>
                  {a.name.slice(0, 1).toUpperCase()}
                </span>
                <div style={{ fontWeight: 650, fontSize: 16 }}>{a.name}</div>
              </div>
              <div className="text-2" style={{ fontSize: 13.5, minHeight: 40, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                {a.instructions?.replace(/[#*]/g, "").trim().slice(0, 120) || "No instructions yet."}
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: 14, flexWrap: "wrap" }}>
                {(a.mcps ?? []).map((id: string) => (
                  <span key={id} className="badge badge-soft"><Icon name={mcpById(id)?.icon ?? "spark"} size={12} /> {mcpById(id)?.name ?? id}</span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
