"use client";

import { useEffect, useState } from "react";
import { api } from "../../lib/api";
import { useAuth } from "../../lib/useAuth";
import { Icon } from "../components/Icon";

const MOONPAY = process.env.NEXT_PUBLIC_MOONPAY_KEY;

export default function Bank() {
  const ready = useAuth();
  const [w, setW] = useState<any>(null);
  const [tab, setTab] = useState<"send" | "receive" | "add">("add");
  const [copied, setCopied] = useState(false);

  async function load() { const r = await api.bank.wallet().catch(() => null); if (r && !r.error) setW(r); }
  useEffect(() => { if (ready) load(); }, [ready]);
  if (!ready) return null;

  const money = (v: any) => `$${Number(v ?? 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  function copy() { if (w?.evmAddress) { navigator.clipboard?.writeText(w.evmAddress).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); } }
  const moonpayUrl = w && MOONPAY ? `https://buy.moonpay.com?apiKey=${MOONPAY}&currencyCode=usdc_base&walletAddress=${w.evmAddress}` : null;

  return (
    <main className="container" style={{ paddingTop: 22, paddingBottom: 70, maxWidth: 620 }}>
      <h1 style={{ marginBottom: 16 }}>Bank</h1>

      {/* Balance */}
      <div className="card" style={{ textAlign: "center", padding: "26px 20px" }}>
        <div className="muted" style={{ fontSize: 13 }}>Spendable balance</div>
        <div className="display" style={{ fontSize: 44, fontWeight: 800, margin: "6px 0 2px" }}>{money(w?.valueUsd)}</div>
        <div className="text-2 mono" style={{ fontSize: 13 }}>{w ? `${w.usdc.toFixed(2)} USDC · ${w.eth.toFixed(5)} ETH` : "loading…"}</div>
      </div>

      {/* Actions */}
      <div style={{ display: "flex", gap: 6, background: "var(--surface-2)", padding: 4, borderRadius: 12, margin: "14px 0" }}>
        {([["add", "Add money"], ["send", "Send"], ["receive", "Receive"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} style={{ flex: 1, padding: "9px 0", borderRadius: 9, border: "none", cursor: "pointer", fontWeight: 650, fontSize: 13, background: tab === k ? "var(--brand)" : "transparent", color: tab === k ? "var(--on-brand)" : "var(--text-2)" }}>{label}</button>
        ))}
      </div>

      {tab === "add" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontWeight: 650 }}>Add money → USDC</div>
          {moonpayUrl ? (
            <>
              <p className="text-2" style={{ fontSize: 13.5 }}>Buy USDC with a debit card or Apple Pay — it lands in your Bank wallet on Base, spendable instantly.</p>
              <a href={moonpayUrl} target="_blank" rel="noreferrer" className="btn btn-solid" style={{ alignSelf: "flex-start" }}>Buy USDC with card / Apple Pay</a>
            </>
          ) : (
            <p className="text-2" style={{ fontSize: 13.5 }}>Card/Apple Pay on-ramp goes live once a provider key (MoonPay / Coinbase Onramp) is added. Until then, send USDC on <strong>Base</strong> to your address (Receive tab) from any exchange or wallet.</p>
          )}
          <div className="muted" style={{ fontSize: 12 }}>Off-ramp (USDC → your bank) and yield on idle USDC are coming next.</div>
        </div>
      )}

      {tab === "receive" && (
        <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ fontWeight: 650 }}>Receive USDC / ETH on Base</div>
          <p className="text-2" style={{ fontSize: 13 }}>Send funds on the <strong>Base</strong> network to this address.</p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <code className="mono" style={{ fontSize: 12.5, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{w?.evmAddress ?? "…"}</code>
            <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
          </div>
        </div>
      )}

      {tab === "send" && <SendForm onSent={load} balance={w} />}

      {/* Card */}
      <div className="card" style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
        <span style={{ width: 40, height: 40, borderRadius: 10, background: "var(--brand-soft)", color: "var(--brand)", display: "inline-flex", alignItems: "center", justifyContent: "center", border: "1px solid var(--brand-ring)" }}><Icon name="wallet" size={20} /></span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>Debit card</div>
          <div className="muted" style={{ fontSize: 12.5 }}>Spend USDC anywhere Visa is accepted.</div>
        </div>
        <span className="badge badge-soft">Setup required</span>
      </div>
      <p className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>Card issuance needs a provider account + KYC (Kast/Coinbase for a personal card, or Rain/Baanx to issue your own). Once connected it shows here.</p>
    </main>
  );
}

function SendForm({ onSent, balance }: { onSent: () => void; balance: any }) {
  const [to, setTo] = useState("");
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<any>(null);

  async function send() {
    setBusy(true); setMsg(null);
    try { const r = await api.bank.send({ to: to.trim(), asset, amount: Number(amount) }); setMsg(r); if (r.ok) { setAmount(""); setTo(""); setTimeout(onSent, 3000); } }
    catch (e) { setMsg({ error: e instanceof Error ? e.message : "failed" }); }
    finally { setBusy(false); }
  }
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ fontWeight: 650 }}>Send</div>
      <div style={{ display: "flex", gap: 6 }}>
        {(["USDC", "ETH"] as const).map((a) => <button key={a} onClick={() => setAsset(a)} className={`badge ${asset === a ? "badge-brand" : "badge-soft"}`} style={{ height: 32, cursor: "pointer", border: "none", padding: "0 14px" }}>{a}</button>)}
        <div style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>{asset === "USDC" ? `${balance?.usdc?.toFixed(2) ?? "—"} available` : `${balance?.eth?.toFixed(5) ?? "—"} available`}</span>
      </div>
      <input className="input mono" placeholder="Recipient 0x… (Base)" value={to} onChange={(e) => setTo(e.target.value)} />
      <input className="input" placeholder={`Amount ${asset}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button className="btn btn-solid" onClick={send} disabled={busy || !to || !(Number(amount) > 0)}>{busy ? "Sending…" : `Send ${asset}`}</button>
      {msg?.ok && <p style={{ fontSize: 12.5, color: "var(--green)" }}>Sent ✓ <a href={`https://basescan.org/tx/${msg.txHash}`} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>view</a></p>}
      {msg && !msg.ok && <p style={{ fontSize: 12.5, color: "var(--red)" }}>{msg.error}</p>}
    </div>
  );
}
