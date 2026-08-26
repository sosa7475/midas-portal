"use client";

import { useState } from "react";
import { useAuth } from "../../lib/useAuth";

export default function Wallet() {
  const ready = useAuth();
  const [connected, setConnected] = useState(false);
  if (!ready) return null;

  const metrics = [
    { label: "Equity", value: connected ? "$0.00" : "—" },
    { label: "Realized PnL (30d)", value: connected ? "$0.00" : "—" },
    { label: "Win rate", value: connected ? "—" : "—" },
    { label: "Sharpe (30d)", value: connected ? "—" : "—" },
    { label: "Max drawdown", value: connected ? "—" : "—" },
    { label: "Open positions", value: connected ? "0" : "—" },
  ];

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80, maxWidth: 900 }}>
      <h1 style={{ marginBottom: 4 }}>Wallet</h1>
      <p className="text-2" style={{ marginBottom: 26 }}>Connect Orderly to trade and track your performance.</p>

      <div className="card" style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 26 }}>⚡</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 650 }}>Orderly Network</div>
            <div className="text-2" style={{ fontSize: 14 }}>
              {connected ? "Connected · trading enabled" : "Non-custodial perps. Connect a wallet to onboard and fund your account."}
            </div>
          </div>
          <span className={`badge ${connected ? "badge-on" : "badge-soft"}`}>{connected ? "Connected" : "Not connected"}</span>
        </div>
        {!connected && (
          <div style={{ marginTop: 16, display: "flex", gap: 10 }}>
            <button className="btn btn-solid" onClick={() => setConnected(true)}>Connect Orderly wallet</button>
            <button className="btn btn-outline">Use existing API key</button>
          </div>
        )}
        {connected && (
          <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>
            Live execution & the persistent position/PnL feed run on the trading engine (separate from this app).
            Fund your Orderly account to start trading; metrics populate as fills come in.
          </p>
        )}
      </div>

      <h2 style={{ marginBottom: 12 }}>Performance</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 14 }}>
        {metrics.map((m) => (
          <div key={m.label} className="card-flat">
            <div className="muted" style={{ fontSize: 13 }}>{m.label}</div>
            <div style={{ fontSize: 22, fontWeight: 700, marginTop: 4 }}>{m.value}</div>
          </div>
        ))}
      </div>
    </main>
  );
}
