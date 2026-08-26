import Link from "next/link";
import { Icon } from "./components/Icon";

export default function Landing() {
  return (
    <main className="container" style={{ paddingTop: 90, paddingBottom: 80, textAlign: "center" }}>
      <div style={{ maxWidth: 720, margin: "0 auto" }}>
        <span className="badge badge-brand" style={{ marginBottom: 22 }}>◆ Agentic trading, your rules</span>
        <h1 style={{ fontSize: 46, lineHeight: 1.1, marginBottom: 20 }}>
          Build trading agents that<br />think like you do.
        </h1>
        <p className="text-2" style={{ fontSize: 18, maxWidth: 560, margin: "0 auto 32px" }}>
          Create your own AI agents, give them your strategy, and connect trading MCPs —
          technical analysis, DeFiLlama, on-chain metrics, and Orderly for execution.
          Then just talk to them.
        </p>
        <div style={{ display: "flex", gap: 12, justifyContent: "center" }}>
          <Link href="/login" className="btn btn-solid" style={{ height: 46, padding: "0 26px" }}>Get started</Link>
          <Link href="/login" className="btn btn-outline" style={{ height: 46, padding: "0 26px" }}>Sign in</Link>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 16, marginTop: 64, textAlign: "left" }}>
        {[
          { t: "Create agents", d: "Name it, write its strategy & instructions — its own agent.md.", i: "cpu" },
          { t: "Connect MCPs", d: "Technical analysis, DeFiLlama, Moralis on-chain, Orderly.", i: "plug" },
          { t: "Trade on Orderly", d: "Execute perps, track balance, PnL, and Sharpe ratio.", i: "bolt" },
          { t: "Just converse", d: "Agentic terminal chat that shows its thinking.", i: "terminal" },
        ].map((f) => (
          <div key={f.t} className="card-flat">
            <div style={{ width: 40, height: 40, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--brand-soft)", color: "var(--brand)", border: "1px solid var(--brand-ring)", marginBottom: 12 }}><Icon name={f.i} size={20} /></div>
            <div style={{ fontWeight: 650, marginBottom: 5 }}>{f.t}</div>
            <div className="muted" style={{ fontSize: 14 }}>{f.d}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
