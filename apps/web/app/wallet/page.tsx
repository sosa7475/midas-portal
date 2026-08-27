"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { Icon } from "../components/Icon";

export default function Wallet() {
  const ready = useAuth();
  const [agents, setAgents] = useState<any[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, any>>({});
  const [modalAgent, setModalAgent] = useState<string | null>(null);

  async function refresh() {
    const [a, s] = await Promise.all([api.agents.list().catch(() => ({ agents: [] })), api.orderly.list().catch(() => ({ statuses: {} }))]);
    setAgents(a.agents);
    setStatuses(s.statuses ?? {});
  }
  useEffect(() => { if (ready) refresh(); }, [ready]);
  if (!ready) return null;

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80, maxWidth: 920 }}>
      <h1 style={{ marginBottom: 4 }}>Wallet</h1>
      <p className="text-2" style={{ marginBottom: 8 }}>Each agent has its own <strong>segregated</strong> Orderly (QuickPerps) account — isolated funds, keys, and risk.</p>
      <p className="muted" style={{ marginBottom: 26, fontSize: 13 }}>Keys are stored encrypted (AES-256-GCM) and scoped read/trading — no withdrawal rights.</p>

      {agents === null ? (
        <p className="muted">Loading…</p>
      ) : agents.length === 0 ? (
        <div className="card" style={{ textAlign: "center", padding: 40 }}>
          <p className="text-2" style={{ marginBottom: 16 }}>Create an agent first — each one gets its own trading account.</p>
          <Link href="/agents/new" className="btn btn-solid">Create an agent</Link>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {agents.map((a) => (
            <AgentWallet key={a.id} agent={a} status={statuses[a.id]} onConnectKey={() => setModalAgent(a.id)} onChange={refresh} />
          ))}
        </div>
      )}

      {modalAgent && <ApiKeyModal agentId={modalAgent} onClose={() => setModalAgent(null)} onDone={async () => { setModalAgent(null); await refresh(); }} />}
    </main>
  );
}

function AgentWallet({ agent, status, onConnectKey, onChange }: { agent: any; status: any; onConnectKey: () => void; onChange: () => void }) {
  const connected = !!status?.connected;
  const [account, setAccount] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => { if (connected) api.orderly.account(agent.id).then(setAccount).catch(() => {}); }, [connected, agent.id]);

  const money = (v: any) => v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  async function generate() { setBusy("gen"); try { await api.orderly.generate(agent.id); await onChange(); } finally { setBusy(null); } }
  async function disconnect() { setBusy("disc"); await api.orderly.disconnect(agent.id).catch(() => {}); setAccount(null); await onChange(); setBusy(null); }
  async function fund() {
    setBusy("fund");
    try {
      await api.orderly.faucet(agent.id);
      // balance takes a few seconds to reflect — poll a couple times
      for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 2500)); const a = await api.orderly.account(agent.id).catch(() => null); if (a?.equity > 0) { setAccount(a); break; } setAccount(a); }
    } finally { setBusy(null); }
  }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,var(--brand-2),var(--brand))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{agent.name.slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>{agent.name}</div>
          <div className="text-2 mono" style={{ fontSize: 12.5 }}>
            {connected ? `Orderly · ${status.network} · ${status.address ? status.address.slice(0, 6) + "…" + status.address.slice(-4) : status.accountId?.slice(0, 10) + "…"}` : "No trading account"}
          </div>
        </div>
        <span className={`badge ${connected ? "badge-on" : "badge-soft"}`}>{connected ? "Connected" : "Not connected"}</span>
      </div>

      {!connected ? (
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-solid btn-sm" onClick={generate} disabled={busy === "gen"}>{busy === "gen" ? "Creating…" : "Generate testnet account"}</button>
          <button className="btn btn-outline btn-sm" onClick={onConnectKey}>Use existing API key</button>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
            {[["Equity", money(account?.equity)], ["PnL (30d)", money(account?.realizedPnl30d)], ["Positions", account ? String(account.openPositions ?? 0) : "—"], ["Free", money(account?.freeCollateral)]].map(([k, v]) => (
              <div key={k}><div className="muted" style={{ fontSize: 11 }}>{k}</div><div style={{ fontWeight: 700, fontSize: 16 }}>{v}</div></div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            {status.network === "testnet" && <button className="btn btn-outline btn-sm" onClick={fund} disabled={busy === "fund"}>{busy === "fund" ? "Funding…" : "Get testnet USDC"}</button>}
            {status.address && <span className="muted mono" style={{ fontSize: 12 }}>{status.address.slice(0, 10)}… · {status.network}</span>}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy === "disc"}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}

function ApiKeyModal({ agentId, onClose, onDone }: { agentId: string; onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [orderlyKey, setOrderlyKey] = useState("");
  const [secretHex, setSecretHex] = useState("");
  const [network, setNetwork] = useState("testnet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { await api.orderly.connectKey(agentId, { accountId, orderlyKey, secretHex, network }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect"); setBusy(false); }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Connect Orderly account</h2>
        <p className="text-2" style={{ fontSize: 13.5, marginBottom: 18 }}>This agent&apos;s own account. Paste an Orderly account id + ed25519 orderly-key. Stored encrypted; scoped read/trading (no withdrawals).</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">Network</label>
            <div style={{ display: "flex", gap: 8 }}>{["testnet", "mainnet"].map((n) => <span key={n} className={`chip${network === n ? " on" : ""}`} onClick={() => setNetwork(n)}>{n}</span>)}</div>
          </div>
          <div><label className="label">Account ID</label><input className="input mono" placeholder="0x…" value={accountId} onChange={(e) => setAccountId(e.target.value)} /></div>
          <div><label className="label">Orderly key</label><input className="input mono" placeholder="ed25519:…" value={orderlyKey} onChange={(e) => setOrderlyKey(e.target.value)} /></div>
          <div><label className="label">Secret (hex)</label><input className="input mono" placeholder="64 hex chars" value={secretHex} onChange={(e) => setSecretHex(e.target.value)} type="password" /></div>
          {error && <p style={{ color: "var(--red)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
            <button className="btn btn-solid" onClick={submit} disabled={busy}>{busy ? "Connecting…" : "Connect"}</button>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
}
