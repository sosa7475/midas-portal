"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { ConnectWallet } from "../components/ConnectWallet";

export default function Wallet() {
  const ready = useAuth();
  const [agents, setAgents] = useState<any[] | null>(null);
  const [statuses, setStatuses] = useState<Record<string, any>>({});

  async function refresh() {
    const [a, s] = await Promise.all([api.agents.list().catch(() => ({ agents: [] })), api.hl.list().catch(() => ({ statuses: {} }))]);
    setAgents(a.agents);
    setStatuses(s.statuses ?? {});
  }
  useEffect(() => { if (ready) refresh(); }, [ready]);
  if (!ready) return null;

  return (
    <main className="container" style={{ paddingTop: 34, paddingBottom: 80, maxWidth: 920 }}>
      <h1 style={{ marginBottom: 4 }}>Wallet</h1>
      <p className="text-2" style={{ marginBottom: 8 }}>Each agent has its own <strong>segregated</strong> Hyperliquid perps account — isolated funds, keys, and risk.</p>
      <p className="muted" style={{ marginBottom: 26, fontSize: 13 }}>The agent key is stored encrypted (AES-256-GCM) and is trade-only — it cannot withdraw. Funds stay under your control.</p>

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
            <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <AgentWallet agent={a} status={statuses[a.id]} onChange={refresh} />
              <OnchainWallet agent={a} />
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function AgentWallet({ agent, status, onChange }: { agent: any; status: any; onChange: () => void }) {
  const connected = !!status?.connected;
  const [account, setAccount] = useState<any>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function loadAccount() { const a = await api.hl.account(agent.id).catch(() => null); if (a) setAccount(a); }
  useEffect(() => { if (connected) loadAccount(); }, [connected, agent.id]);

  const money = (v: any) => v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const addr = status?.address ?? account?.address;

  async function generate() { setBusy("gen"); try { await api.hl.generate(agent.id); await onChange(); } finally { setBusy(null); } }
  async function disconnect() { setBusy("disc"); await api.hl.disconnect(agent.id).catch(() => {}); setAccount(null); await onChange(); setBusy(null); }
  async function copy() { if (addr) { await navigator.clipboard.writeText(addr).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } }

  return (
    <div className="card">
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,var(--brand-2),var(--brand))", color: "#fff", display: "inline-flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>{agent.name.slice(0, 1).toUpperCase()}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>{agent.name}</div>
          <div className="text-2 mono" style={{ fontSize: 12.5 }}>
            {connected ? `Hyperliquid · ${status.network} · ${addr ? addr.slice(0, 6) + "…" + addr.slice(-4) : "—"}` : "No trading account"}
          </div>
        </div>
        <span className={`badge ${connected ? "badge-on" : "badge-soft"}`}>{connected ? "Connected" : "Not connected"}</span>
      </div>

      {!connected ? (
        <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button className="btn btn-solid btn-sm" onClick={generate} disabled={busy === "gen"}>{busy === "gen" ? "Creating…" : "Create trading account"}</button>
        </div>
      ) : (
        <>
          <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginTop: 16 }}>
            {[["Equity", money(account?.equity)], ["Free collateral", money(account?.freeCollateral)], ["Open positions", account ? String(account.openPositions ?? 0) : "—"], ["Network", status.network]].map(([k, v]) => (
              <div key={k}><div className="muted" style={{ fontSize: 11 }}>{k}</div><div style={{ fontWeight: 700, fontSize: 16 }}>{v}</div></div>
            ))}
          </div>

          {(!account?.equity || account.equity === 0) && (
            <div style={{ marginTop: 16, padding: 14, borderRadius: 10, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 6 }}>Fund this account to start trading</div>
              <p className="text-2" style={{ fontSize: 13, marginBottom: 10 }}>
                Send USDC to this agent&apos;s address on Hyperliquid ({status.network}), or approve it as an agent wallet on your funded HL account. On {status.network}, use the <a href={status.network === "testnet" ? "https://app.hyperliquid-testnet.xyz/drip" : "https://app.hyperliquid.xyz"} target="_blank" rel="noreferrer" style={{ color: "var(--brand)" }}>Hyperliquid app</a>.
              </p>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <code className="mono" style={{ fontSize: 12.5, background: "var(--surface)", padding: "6px 10px", borderRadius: 7, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{addr}</code>
                <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
                <button className="btn btn-ghost btn-sm" onClick={loadAccount}>Refresh</button>
              </div>
            </div>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
            {account?.equity > 0 && <button className="btn btn-outline btn-sm" onClick={loadAccount}>Refresh</button>}
            <div style={{ flex: 1 }} />
            <button className="btn btn-ghost btn-sm" onClick={disconnect} disabled={busy === "disc"}>Disconnect</button>
          </div>
        </>
      )}
    </div>
  );
}

function OnchainWallet({ agent }: { agent: any }) {
  const [acct, setAcct] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);

  async function load() { const a = await api.turnkey.get(agent.id).catch(() => null); setAcct(a); setLoaded(true); }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [agent.id]);

  const [chainMsg, setChainMsg] = useState<string | null>(null);
  async function provision() { setBusy(true); try { await api.turnkey.provision(agent.id); await load(); } finally { setBusy(false); } }
  async function enableChains() { setChainMsg("Enabling…"); try { const r = await api.turnkey.upgrade(agent.id); setChainMsg(r.ok ? "All chains enabled ✓" : (r.error || "Failed")); } catch { setChainMsg("Failed"); } }
  if (!loaded) return null;

  return (
    <div className="card" style={{ borderColor: "var(--gold-ring)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="badge badge-gold" style={{ height: 22 }}>On-chain · Base</span>
        <div style={{ fontWeight: 650 }}>{agent.name} — spot wallet</div>
      </div>
      {!acct?.connected ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <p className="text-2" style={{ fontSize: 13 }}>Create this agent&apos;s trade-only on-chain wallet to trade tokens (Uniswap) on Base. It can swap but never withdraw to anyone but you.</p>
          <button className="btn btn-solid btn-sm" onClick={provision} disabled={busy} style={{ alignSelf: "flex-start" }}>{busy ? "Creating…" : "Create on-chain wallet"}</button>
        </div>
      ) : (
        <>
          {acct.balances && (
            <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, marginBottom: 14 }}>
              {[["ETH + USDC value (partial)", acct.coreValueUsd==null?"Unavailable":`$${acct.coreValueUsd.toLocaleString("en-US", { maximumFractionDigits: 2 })}`], ["USDC", `$${(acct.balances.usdc ?? "Unavailable").toLocaleString()}`], ["ETH", String(acct.balances.eth ?? "Unavailable")]].map(([k, v]) => (
                <div key={k}><div className="muted" style={{ fontSize: 11 }}>{k}</div><div style={{ fontWeight: 700, fontSize: 15 }}>{v}</div></div>
              ))}
            </div>
          )}
          <ConnectWallet toAddress={acct.evmAddress} />
          <WithdrawPanel agentId={agent.id} acct={acct} onDone={load} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span className="muted" style={{ fontSize: 12 }}>Trades on Ethereum · Arbitrum · Optimism · Base · Hood Chain.</span>
            <div style={{ flex: 1 }} />
            <button className="btn btn-outline btn-sm" onClick={enableChains}>Enable all chains</button>
            {chainMsg && <span style={{ fontSize: 12, color: chainMsg.includes("✓") ? "var(--green)" : "var(--text-2)" }}>{chainMsg}</span>}
          </div>
        </>
      )}
    </div>
  );
}

function WithdrawPanel({ agentId, acct, onDone }: { agentId: string; acct: any; onDone: () => void }) {
  const [addr, setAddr] = useState(acct.ownerAddress ?? "");
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const hasOwner = !!acct.ownerAddress;

  async function setOwner() { setBusy(true); setMsg(null); try { const r = await api.turnkey.setOwner(agentId, addr.trim()); setMsg(r.ok ? "Withdrawal address set ✓" : (r.error || "Failed")); if (r.ok) onDone(); } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } }
  async function withdraw() { setBusy(true); setMsg("Submitting…"); try { const r = await api.turnkey.withdraw(agentId, { asset, amount: Number(amount) }); setMsg(r.ok ? "Withdrawal sent ✓" : (r.error || "Failed")); if (r.ok) { setAmount(""); setTimeout(onDone, 3000); } } catch (e) { setMsg(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); } }

  return (
    <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
      <div style={{ fontWeight: 600, fontSize: 13.5, marginBottom: 8 }}>Withdraw</div>
      {!hasOwner ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="input" style={{ flex: 1, minWidth: 180, height: 36 }} placeholder="Your wallet address (0x…) — funds only ever return here" value={addr} onChange={(e) => setAddr(e.target.value)} />
          <button className="btn btn-solid btn-sm" onClick={setOwner} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(addr.trim())}>Set address</button>
        </div>
      ) : (
        <>
          <div className="muted mono" style={{ fontSize: 12, marginBottom: 8 }}>To: {acct.ownerAddress.slice(0, 10)}…{acct.ownerAddress.slice(-6)} (your address, locked)</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4 }}>{(["USDC", "ETH"] as const).map((a) => <button key={a} onClick={() => setAsset(a)} className={`badge ${asset === a ? "badge-brand" : "badge-soft"}`} style={{ height: 32, cursor: "pointer", border: "none", padding: "0 12px" }}>{a}</button>)}</div>
            <input className="input" style={{ flex: 1, minWidth: 110, height: 34 }} placeholder={`Amount ${asset}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn btn-solid btn-sm" onClick={withdraw} disabled={busy || !(Number(amount) > 0)}>Withdraw</button>
          </div>
        </>
      )}
      {msg && <p style={{ fontSize: 12.5, marginTop: 8, color: msg.includes("✓") ? "var(--green)" : "var(--text-2)" }}>{msg}</p>}
    </div>
  );
}
