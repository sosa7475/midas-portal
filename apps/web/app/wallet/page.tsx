"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { Icon } from "../components/Icon";

export default function Wallet() {
  const ready = useAuth();
  const [status, setStatus] = useState<any>(null); // null=loading
  const [account, setAccount] = useState<any>(null);
  const [modal, setModal] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const st = await api.orderly.status().catch(() => ({ connected: false }));
    setStatus(st);
    if (st.connected) setAccount(await api.orderly.account().catch(() => null));
  }
  useEffect(() => { if (ready) refresh(); }, [ready]);
  if (!ready) return null;

  async function generate() {
    setBusy("generate"); setError(null);
    try { await api.orderly.generate(); await refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(null); }
  }
  async function disconnect() {
    setBusy("disc"); await api.orderly.disconnect().catch(() => {}); setAccount(null); await refresh(); setBusy(null);
  }

  const connected = status?.connected;
  const money = (v: number | undefined | null) => v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const metrics = [
    { label: "Equity", value: connected ? money(account?.equity) : "—" },
    { label: "Free collateral", value: connected ? money(account?.freeCollateral) : "—" },
    { label: "Realized PnL (30d)", value: connected ? money(account?.realizedPnl30d) : "—" },
    { label: "Win rate", value: connected && account?.winRate != null ? `${(account.winRate * 100).toFixed(1)}%` : "—" },
    { label: "Open positions", value: connected ? String(account?.openPositions ?? 0) : "—" },
    { label: "Sharpe (30d)", value: "—" },
  ];

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80, maxWidth: 920 }}>
      <h1 style={{ marginBottom: 4 }}>Wallet</h1>
      <p className="text-2" style={{ marginBottom: 26 }}>Connect Orderly (QuickPerps) to trade and track your performance.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ width: 42, height: 42, borderRadius: 11, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--brand-soft)", color: "var(--brand)", border: "1px solid var(--brand-ring)" }}><Icon name="bolt" size={20} /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 650 }}>Orderly Network · QuickPerps</div>
            <div className="text-2" style={{ fontSize: 14 }}>
              {status == null ? "Checking…" : connected
                ? `Connected · ${status.network} · ${status.address ? status.address.slice(0, 6) + "…" + status.address.slice(-4) : status.accountId?.slice(0, 10) + "…"}`
                : "Non-custodial perps. Generate a testnet account or connect existing API credentials."}
            </div>
          </div>
          <span className={`badge ${connected ? "badge-on" : "badge-soft"}`}>{status == null ? "…" : connected ? "Connected" : "Not connected"}</span>
        </div>

        {status != null && !connected && (
          <div style={{ marginTop: 16, display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-solid" onClick={generate} disabled={busy === "generate"}>{busy === "generate" ? "Creating…" : "Generate testnet account"}</button>
            <button className="btn btn-outline" onClick={() => setModal(true)}>Use existing API key</button>
          </div>
        )}
        {connected && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            {status.address && <span className="muted mono" style={{ fontSize: 12.5 }}>Fund {status.address.slice(0, 10)}… on Orderly {status.network} to start trading.</span>}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy === "disc"}>Disconnect</button>
          </div>
        )}
        {error && <p style={{ color: "var(--red)", fontSize: 13, marginTop: 12 }}>{error}</p>}
      </div>

      <h2 style={{ marginBottom: 12 }}>Performance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(155px, 1fr))", gap: 14 }}>
        {metrics.map((m) => (
          <div key={m.label} className="card-flat">
            <div className="muted" style={{ fontSize: 13 }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{m.value}</div>
          </div>
        ))}
      </div>

      {modal && <ApiKeyModal onClose={() => setModal(false)} onDone={async () => { setModal(false); await refresh(); }} />}
    </main>
  );
}

function ApiKeyModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [accountId, setAccountId] = useState("");
  const [orderlyKey, setOrderlyKey] = useState("");
  const [secretHex, setSecretHex] = useState("");
  const [network, setNetwork] = useState("testnet");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true); setError(null);
    try { await api.orderly.connectKey({ accountId, orderlyKey, secretHex, network }); onDone(); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not connect"); setBusy(false); }
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: "100%" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Connect Orderly API key</h2>
        <p className="text-2" style={{ fontSize: 13.5, marginBottom: 18 }}>Paste an existing Orderly account id + ed25519 orderly-key (from onboarding). Stored encrypted; scoped read/trading (no withdrawals).</p>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label className="label">Network</label>
            <div style={{ display: "flex", gap: 8 }}>
              {["testnet", "mainnet"].map((n) => (
                <span key={n} className={`chip${network === n ? " on" : ""}`} onClick={() => setNetwork(n)}>{n}</span>
              ))}
            </div>
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
