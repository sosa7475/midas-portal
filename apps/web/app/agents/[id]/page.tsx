"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, streamChat } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import { mcpById } from "../../../lib/mcps";
import { Icon } from "../../components/Icon";

interface Msg {
  role: "user" | "agent";
  text: string;
  tools?: { name: string; args: any; done?: boolean }[];
  backtest?: any;
  proposal?: any;
  streaming?: boolean;
}

export default function AgentChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ready = useAuth();
  const [agent, setAgent] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!ready) return;
    api.agents.get(id).then((r) => setAgent(r.agent)).catch(() => setAgent(false));
    // Load persistent conversation memory.
    api.agents.messages(id).then((r) => {
      setMessages((r.messages ?? []).map((m: any) => ({ role: m.role === "user" ? "user" : "agent", text: m.content, tools: m.tools })));
    }).catch(() => {});
  }, [ready, id]);
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  if (!ready) return null;
  if (agent === false) return <main className="container" style={{ paddingTop: 40 }}><p>Agent not found. <Link href="/agents" style={{ color: "var(--brand)" }}>Back</Link></p></main>;

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput(""); setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "agent", text: "", tools: [], streaming: true }]);
    streamChat(text, (e) => {
      setMessages((m) => {
        const copy = [...m]; const last = copy[copy.length - 1];
        if (last?.role !== "agent") return m;
        if (e.type === "tool") last.tools = [...(last.tools ?? []).map(t => ({ ...t, done: true })), { name: e.name, args: e.args }];
        else if (e.type === "backtest") { last.backtest = e.result; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "trade_proposal") { last.proposal = e.proposal; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "delta") { last.tools = last.tools?.map(t => ({ ...t, done: true })); last.text += e.content; }
        else if (e.type === "error") { last.text += `\n[error] ${e.error}`; last.streaming = false; setBusy(false); }
        else if (e.type === "done") { last.streaming = false; last.tools = last.tools?.map(t => ({ ...t, done: true })); setBusy(false); }
        return copy;
      });
    }, id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* terminal header */}
      <div className="glass" style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 20px", borderTop: "none", borderLeft: "none", borderRight: "none", borderRadius: 0 }}>
        <span style={{ display: "flex", gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#ff5f57" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#febc2e" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#28c840" }} />
        </span>
        <span className="mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)" }}>
          <Icon name="terminal" size={16} /> midas@{agent ? agent.name.toLowerCase().replace(/\s+/g, "-") : "agent"}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6 }}>
          {(agent?.mcps ?? []).map((mid: string) => (
            <span key={mid} className="badge badge-soft mono" style={{ height: 20, fontSize: 11 }}>
              <Icon name={mcpById(mid)?.icon ?? "spark"} size={12} /> {mcpById(mid)?.name}
            </span>
          ))}
        </div>
      </div>

      {/* transcript */}
      <div ref={scrollRef} className="mono" style={{ flex: 1, overflowY: "auto", padding: "22px", fontSize: 13.5, lineHeight: 1.75 }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ color: "var(--text-muted)", marginBottom: 18 }}>
            <span style={{ color: "var(--brand)" }}>●</span> {agent?.name ?? "agent"} online — {(agent?.mcps ?? []).length} MCP{(agent?.mcps ?? []).length === 1 ? "" : "s"} connected. Type a command below.
          </div>
          {messages.map((m, i) => <Line key={i} m={m} agentId={id} />)}
        </div>
      </div>

      {/* composer */}
      <div style={{ padding: "12px 22px 20px" }}>
        <div className="glass mono" style={{ maxWidth: 900, margin: "0 auto", display: "flex", alignItems: "center", gap: 10, borderRadius: 14, padding: "6px 8px 6px 16px" }}>
          <span style={{ color: "var(--brand)", fontWeight: 700 }}>❯</span>
          <input
            style={{ flex: 1, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "inherit", fontSize: 14, padding: "9px 0" }}
            placeholder={`ask ${agent?.name ?? "your agent"}…  e.g. analyze BTC 4h vs my strategy`}
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
          />
          <button className="btn btn-solid btn-icon" onClick={send} disabled={busy}><Icon name="send" size={16} /></button>
        </div>
      </div>
    </div>
  );
}

function Line({ m, agentId }: { m: Msg; agentId: string }) {
  if (m.role === "user") {
    return <div style={{ marginBottom: 14 }}><span style={{ color: "var(--brand)", fontWeight: 700 }}>❯ </span><span style={{ color: "var(--text)" }}>{m.text}</span></div>;
  }
  return (
    <div style={{ marginBottom: 22 }}>
      {m.proposal && <TradeProposalCard p={m.proposal} agentId={agentId} />}
      {m.tools?.map((t, i) => (
        <div key={i} style={{ color: "var(--text-2)", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)" }}>$ </span>
          <span style={{ color: "var(--brand)" }}>{t.name}</span>
          <span className="muted"> {Object.entries(t.args).map(([k, v]) => `--${k} ${v}`).join(" ")}</span>
          <span style={{ marginLeft: 8, color: t.done ? "var(--green)" : "var(--text-muted)" }}>{t.done ? "✓" : <span className="dot-pulse">…</span>}</span>
        </div>
      ))}
      {m.backtest && <BacktestCard r={m.backtest} />}
      <div style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>
        {m.text}
        {m.streaming && <span style={{ color: "var(--brand)", animation: "blink 1s step-end infinite" }}>▋</span>}
        {m.streaming && !m.text && <span className="muted">running…</span>}
      </div>
    </div>
  );
}

function TradeProposalCard({ p, agentId }: { p: any; agentId: string }) {
  const [state, setState] = useState<"idle" | "executing" | "done" | "rejected">("idle");
  const [result, setResult] = useState<any>(null);
  const long = p.side === "long";

  async function confirm() {
    setState("executing");
    try {
      const r = await api.orderly.order(agentId, { symbol: p.symbol, side: p.side, type: p.type, quantity: p.quantity, price: p.price });
      setResult(r); setState("done");
    } catch (e) { setResult({ error: e instanceof Error ? e.message : "failed" }); setState("done"); }
  }

  return (
    <div className="card" style={{ margin: "4px 0 12px", padding: 16, borderColor: "var(--brand-ring)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <span className="badge" style={{ background: long ? "rgba(47,158,111,.12)" : "rgba(209,72,58,.12)", color: long ? "var(--green)" : "var(--red)", border: `1px solid ${long ? "rgba(47,158,111,.3)" : "rgba(209,72,58,.3)"}` }}>{p.side.toUpperCase()}</span>
        <span style={{ fontWeight: 650 }} className="mono">{p.symbol}</span>
        <span className="muted mono" style={{ fontSize: 13 }}>{p.type} · {p.quantity} · ~${p.notionalUsd?.toLocaleString()} · {p.network}</span>
      </div>
      {state === "idle" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-solid btn-sm" onClick={confirm}>Confirm &amp; place</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setState("rejected")}>Reject</button>
        </div>
      )}
      {state === "executing" && <div className="muted mono" style={{ fontSize: 13 }}><span className="dot-pulse">●</span> placing order…</div>}
      {state === "rejected" && <div className="muted" style={{ fontSize: 13 }}>Rejected — no order placed.</div>}
      {state === "done" && (
        <div style={{ fontSize: 13 }} className="mono">
          {result?.placed ? <span style={{ color: "var(--green)" }}>✓ Order placed{result.order?.order_id ? ` · #${result.order.order_id}` : ""}</span>
            : result?.blockedByRiskEngine ? <span style={{ color: "var(--red)" }}>⚠ Blocked by risk engine: {result.violations?.join("; ")}</span>
            : <span style={{ color: "var(--red)" }}>✕ {result?.error || "Order failed"}</span>}
        </div>
      )}
    </div>
  );
}

function BacktestCard({ r }: { r: any }) {
  const curve: number[] = r.equityCurve ?? [];
  const W = 620, H = 130, pad = 6;
  const min = Math.min(...curve, 10000), max = Math.max(...curve, 10000);
  const x = (i: number) => pad + (i / Math.max(1, curve.length - 1)) * (W - 2 * pad);
  const y = (v: number) => pad + (1 - (v - min) / (max - min || 1)) * (H - 2 * pad);
  const path = curve.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${path} L${x(curve.length - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const up = curve.length > 1 && curve[curve.length - 1] >= curve[0];
  const col = up ? "var(--green)" : "var(--red)";
  const stats: [string, string][] = [
    ["Return", `${r.totalReturnPct > 0 ? "+" : ""}${r.totalReturnPct}%`],
    ["CAGR", r.cagrPct != null ? `${r.cagrPct}%` : "—"],
    ["Sharpe", r.sharpe != null ? String(r.sharpe) : "—"],
    ["Max DD", `${r.maxDrawdownPct}%`],
    ["Win rate", r.winRatePct != null ? `${r.winRatePct}%` : "—"],
    ["Profit factor", r.profitFactor != null ? String(r.profitFactor) : "—"],
    ["Trades", String(r.trades)],
    ["Exposure", `${r.exposurePct}%`],
  ];
  return (
    <div className="card" style={{ margin: "6px 0 12px", padding: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 10 }}>
        <div style={{ fontWeight: 650, fontSize: 14 }} className="mono">{r.symbol} · {r.interval}</div>
        <div className="muted mono" style={{ fontSize: 12 }}>{r.from} → {r.to} · {r.bars} bars</div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none" style={{ display: "block" }}>
        <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={col} stopOpacity="0.22" /><stop offset="100%" stopColor={col} stopOpacity="0" /></linearGradient></defs>
        <line x1={pad} y1={y(10000)} x2={W - pad} y2={y(10000)} stroke="var(--border-strong)" strokeWidth="1" strokeDasharray="3 4" />
        <path d={area} fill="url(#eq)" />
        <path d={path} fill="none" stroke={col} strokeWidth="2" />
      </svg>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 12 }}>
        {stats.map(([k, v]) => (
          <div key={k}>
            <div className="muted" style={{ fontSize: 11 }}>{k}</div>
            <div className="mono" style={{ fontWeight: 650, fontSize: 14 }}>{v}</div>
          </div>
        ))}
      </div>
      {r.note && <div className="muted" style={{ fontSize: 12, marginTop: 10 }}>{r.note}</div>}
    </div>
  );
}
