"use client";

import { useState } from "react";
import { encodeFunctionData, parseUnits } from "viem";

const BASE_HEX = "0x2105"; // 8453
const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const ERC20_TRANSFER = [{ name: "transfer", type: "function", inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ type: "bool" }], stateMutability: "nonpayable" }] as const;

type Eth = { request: (a: { method: string; params?: any[] }) => Promise<any> };
const eth = (): Eth | null => (typeof window !== "undefined" ? (window as any).ethereum ?? null : null);

/** Connect an injected wallet (MetaMask/Coinbase/Rabby) and deposit into the agent's trade-only Base wallet. */
export function ConnectWallet({ toAddress }: { toAddress: string }) {
  const [addr, setAddr] = useState<string | null>(null);
  const [asset, setAsset] = useState<"USDC" | "ETH">("USDC");
  const [amount, setAmount] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [tx, setTx] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const provider = eth();

  async function connect() {
    const p = eth(); if (!p) return;
    setStatus(null);
    try {
      const accts = await p.request({ method: "eth_requestAccounts" });
      setAddr(accts?.[0] ?? null);
      const chain = await p.request({ method: "eth_chainId" });
      if (chain !== BASE_HEX) {
        try { await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: BASE_HEX }] }); }
        catch { setStatus("Please switch your wallet to Base network."); }
      }
    } catch { setStatus("Connection cancelled."); }
  }

  async function deposit() {
    const p = eth(); if (!p || !addr) return;
    if (!(Number(amount) > 0)) { setStatus("Enter an amount."); return; }
    setStatus("Confirm in your wallet…"); setTx(null);
    try {
      let params: any;
      if (asset === "ETH") {
        params = { from: addr, to: toAddress, value: "0x" + parseUnits(amount, 18).toString(16) };
      } else {
        params = { from: addr, to: USDC_BASE, data: encodeFunctionData({ abi: ERC20_TRANSFER, functionName: "transfer", args: [toAddress as `0x${string}`, parseUnits(amount, 6)] }) };
      }
      const hash = await p.request({ method: "eth_sendTransaction", params: [params] });
      setTx(hash); setStatus(null); setAmount("");
    } catch (e: any) { setStatus(e?.message?.slice(0, 120) || "Transaction rejected."); }
  }

  function copy() { navigator.clipboard?.writeText(toAddress).catch(() => {}); setCopied(true); setTimeout(() => setCopied(false), 1500); }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {!provider ? (
        <p className="muted" style={{ fontSize: 12.5 }}>No browser wallet detected. Open this page in your wallet app&apos;s browser, or send funds to the address below from any wallet.</p>
      ) : !addr ? (
        <button className="btn btn-solid btn-sm" onClick={connect}>Connect Wallet</button>
      ) : (
        <>
          <div className="muted mono" style={{ fontSize: 12 }}>Connected: {addr.slice(0, 6)}…{addr.slice(-4)}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ display: "flex", gap: 4 }}>
              {(["USDC", "ETH"] as const).map((a) => (
                <button key={a} onClick={() => setAsset(a)} className={`badge ${asset === a ? "badge-brand" : "badge-soft"}`} style={{ height: 30, cursor: "pointer", border: "none", padding: "0 12px" }}>{a}</button>
              ))}
            </div>
            <input className="input" style={{ flex: 1, minWidth: 120, height: 34 }} placeholder={`Amount ${asset}`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            <button className="btn btn-solid btn-sm" onClick={deposit}>Deposit</button>
          </div>
        </>
      )}
      {status && <p style={{ fontSize: 12.5, color: "var(--text-2)" }}>{status}</p>}
      {tx && <p style={{ fontSize: 12.5, color: "var(--green)" }}>Deposit sent ✓ <a href={`https://basescan.org/tx/${tx}`} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>view</a></p>}

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
        <code className="mono" style={{ fontSize: 12, background: "var(--surface-2)", padding: "6px 10px", borderRadius: 8, flex: 1, overflow: "hidden", textOverflow: "ellipsis" }}>{toAddress}</code>
        <button className="btn btn-outline btn-sm" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="muted" style={{ fontSize: 11.5 }}>Send USDC or ETH on <strong>Base</strong> to this address. It&apos;s the agent&apos;s trade-only wallet — it can trade but never withdraw to anyone but you.</p>
    </div>
  );
}
