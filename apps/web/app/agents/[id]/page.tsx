"use client";
import { TradeIdeaQueue } from "../../components/TradeIdeaQueue";
import { swapOutput } from "../../../lib/swap-output";

import { use, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { api, streamChat } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import { mcpById } from "../../../lib/mcps";
import { Icon } from "../../components/Icon";

interface Msg {
  role: "user" | "agent";
  text: string;
  images?: string[];
  tools?: { name: string; args: any; done?: boolean }[];
  backtest?: any;
  proposal?: any;
  swapProposal?: any;
  strategyProposal?: any;
  strategyUpdate?: any;
  streaming?: boolean;
}

// Downscale to a chart-legible size + JPEG so payloads stay small (<~500KB each).
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("read failed"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("decode failed"));
      img.onload = () => {
        const max = 1400;
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale), h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL("image/jpeg", 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export default function AgentChat({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const ready = useAuth();
  const [agent, setAgent] = useState<any>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [pendingImages, setPendingImages] = useState<string[]>([]);
  const [strat, setStrat] = useState<any>(null);
  const [showConnect, setShowConnect] = useState(false);
  const [showLimits, setShowLimits] = useState(false);
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function addFiles(files: FileList | File[]) {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"));
    for (const f of imgs) {
      if (pendingImages.length >= 4) break;
      try { const url = await fileToDataUrl(f); setPendingImages((p) => (p.length >= 4 ? p : [...p, url])); } catch {}
    }
  }

  useEffect(() => {
    if (!ready) return;
    api.agents.get(id).then((r) => setAgent(r.agent)).catch(() => setAgent(false));
    // Load persistent conversation memory.
    api.agents.messages(id).then((r) => {
      setMessages((r.messages ?? []).map((m: any) => ({ role: m.role === "user" ? "user" : "agent", text: m.content, tools: m.tools })));
    }).catch(() => {});
    api.agents.strategy(id).then(setStrat).catch(() => {});
  }, [ready, id]);
  async function toggleAutoPromote() {
    if (!strat) return;
    const on = !strat.autoPromote;
    setStrat((s: any) => ({ ...s, autoPromote: on }));
    await api.agents.setAutoPromote(id, on).catch(() => setStrat((s: any) => ({ ...s, autoPromote: !on })));
  }
  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  if (!ready) return null;
  if (agent === false) return <main className="container" style={{ paddingTop: 40 }}><p>Agent not found. <Link href="/agents" style={{ color: "var(--brand)" }}>Back</Link></p></main>;

  function send() {
    const text = input.trim();
    const images = pendingImages;
    if ((!text && images.length === 0) || busy) return;
    setInput(""); setPendingImages([]); setBusy(true);
    setMessages((m) => [...m, { role: "user", text, images }, { role: "agent", text: "", tools: [], streaming: true }]);
    streamChat(text, (e) => {
      setMessages((m) => {
        const copy = [...m]; const last = copy[copy.length - 1];
        if (last?.role !== "agent") return m;
        if (e.type === "tool") last.tools = [...(last.tools ?? []).map(t => ({ ...t, done: true })), { name: e.name, args: e.args }];
        else if (e.type === "backtest") { last.backtest = e.result; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "trade_proposal") { last.proposal = e.proposal; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "swap_proposal") { last.swapProposal = e.proposal; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "strategy_proposal") { last.strategyProposal = e.proposal; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "strategy_update") { last.strategyUpdate = e.update; last.tools = last.tools?.map(t => ({ ...t, done: true })); }
        else if (e.type === "delta") { last.tools = last.tools?.map(t => ({ ...t, done: true })); last.text += e.content; }
        else if (e.type === "error") { last.text += `\n[error] ${e.error}`; last.streaming = false; setBusy(false); }
        else if (e.type === "done") { last.streaming = false; last.tools = last.tools?.map(t => ({ ...t, done: true })); setBusy(false); }
        return copy;
      });
    }, id, images);
  }

  return (
    <div className="chat-shell" style={{ display: "flex", flexDirection: "column" }}>
      {/* terminal header */}
      <div className="glass" style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderTop: "none", borderLeft: "none", borderRight: "none", borderRadius: 0, minWidth: 0 }}>
        <span className="term-dots" style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#ff5f57" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#febc2e" }} />
          <span style={{ width: 11, height: 11, borderRadius: 99, background: "#28c840" }} />
        </span>
        <span className="mono" style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--text-2)", flexShrink: 0, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          <Icon name="terminal" size={16} /> midas@{agent ? agent.name.toLowerCase().replace(/\s+/g, "-") : "agent"}
        </span>
        <div style={{ flex: 1 }} />
        <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <button className="badge badge-brand mono" style={{ height: 22, fontSize: 11, cursor: "pointer", border: "none" }} onClick={() => setShowConnect(true)} title="Connect this agent to Claude or ChatGPT">
            <Icon name="plug" size={12} /> Connect AI
          </button>
          <button className="badge badge-soft mono" style={{ height: 22, fontSize: 11, cursor: "pointer", border: "none" }} onClick={() => setShowLimits(true)} title="Risk limits & kill switch">
            <Icon name="shield" size={12} /> Limits
          </button>
          {strat && (
            <>
              <span className="badge badge-soft mono hide-mobile" style={{ height: 22, fontSize: 11 }} title="Active strategy version">
                <Icon name="spark" size={12} /> strategy {strat.active ? `v${strat.active.version}` : "—"}
              </span>
              <button onClick={toggleAutoPromote} title="Auto-promote strategy changes that win out-of-sample"
                className={`badge mono hide-mobile ${strat.autoPromote ? "badge-on" : "badge-soft"}`}
                style={{ height: 22, fontSize: 11, cursor: "pointer", border: "none" }}>
                auto-evolve {strat.autoPromote ? "ON" : "OFF"}
              </button>
            </>
          )}
          {(agent?.mcps ?? []).map((mid: string) => (
            <span key={mid} className="badge badge-soft mono hide-mobile" style={{ height: 22, fontSize: 11 }}>
              <Icon name={mcpById(mid)?.icon ?? "spark"} size={12} /> {mcpById(mid)?.name}
            </span>
          ))}
        </div>
      </div>

      {/* transcript */}
      <div style={{maxHeight:360,overflowY:"auto",padding:"0 16px"}}><TradeIdeaQueue agentId={id} /></div>
      <div ref={scrollRef} className="mono chat-scroll" style={{ flex: 1, padding: "18px 16px", fontSize: 13.5, lineHeight: 1.75 }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          <div style={{ color: "var(--text-muted)", marginBottom: 18 }}>
            <span style={{ color: "var(--brand)" }}>●</span> {agent?.name ?? "agent"} online — {(agent?.mcps ?? []).length} MCP{(agent?.mcps ?? []).length === 1 ? "" : "s"} connected. Type a command below.
          </div>
          {messages.map((m, i) => <Line key={i} m={m} agentId={id} />)}
        </div>
      </div>

      {/* composer */}
      <div style={{ padding: "12px 22px 20px" }}>
        <div style={{ maxWidth: 900, margin: "0 auto" }}>
          {pendingImages.length > 0 && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              {pendingImages.map((src, i) => (
                <div key={i} style={{ position: "relative", width: 60, height: 60, borderRadius: 9, overflow: "hidden", border: "1px solid var(--border-strong)" }}>
                  <img src={src} alt="attachment" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  <button onClick={() => setPendingImages((p) => p.filter((_, j) => j !== i))}
                    style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: 99, border: "none", background: "rgba(0,0,0,0.6)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }} aria-label="Remove">
                    <Icon name="x" size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="glass mono" style={{ display: "flex", alignItems: "center", gap: 10, borderRadius: 14, padding: "6px 8px 6px 16px" }}>
            <span style={{ color: "var(--brand)", fontWeight: 700 }}>❯</span>
            <input
              style={{ flex: 1, minWidth: 0, background: "transparent", border: "none", outline: "none", color: "var(--text)", fontFamily: "inherit", fontSize: 16, padding: "9px 0" }}
              placeholder={`ask ${agent?.name ?? "your agent"}…  attach or paste a chart`}
              value={input} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); send(); } }}
              onPaste={(e) => { const files = Array.from(e.clipboardData.items).filter((it) => it.type.startsWith("image/")).map((it) => it.getAsFile()).filter(Boolean) as File[]; if (files.length) { e.preventDefault(); addFiles(files); } }}
            />
            <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            <button className="btn btn-outline btn-icon" onClick={() => fileRef.current?.click()} disabled={busy || pendingImages.length >= 4} title="Attach chart image"><Icon name="image" size={16} /></button>
            <button className="btn btn-solid btn-icon" onClick={send} disabled={busy}><Icon name="send" size={16} /></button>
          </div>
        </div>
      </div>
      {showConnect && <ConnectModal agentId={id} agentName={agent?.name ?? "agent"} onClose={() => setShowConnect(false)} />}
      {showLimits && <LimitsModal agentId={id} onClose={() => setShowLimits(false)} />}
    </div>
  );
}

function ConnectModal({ agentId, agentName, onClose }: { agentId: string; agentName: string; onClose: () => void }) {
  const [allowExecution,setAllowExecution]=useState(false);
  const [tok, setTok] = useState<{ token: string; url: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [list, setList] = useState<any[] | null>(null);
  async function refresh() { try { const r = await api.agents.connectorList(agentId); setList(r.tokens || []); } catch { setList([]); } }
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [agentId]);
  async function gen() { setBusy(true); try { const r = await api.agents.connectorCreate(agentId, "AI connector",["read","research","propose",...(allowExecution?["execute"]:[])]); setTok(r); await refresh(); } finally { setBusy(false); } }
  async function revoke(id: string) { await api.agents.connectorRevoke(agentId, id).catch(() => {}); await refresh(); }
  function copy(v: string, k: string) { navigator.clipboard.writeText(v).catch(() => {}); setCopied(k); setTimeout(() => setCopied(""), 1500); }
  const fmtDate = (t: any) => { try { return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" }); } catch { return ""; } };
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 560, maxWidth: "100%", maxHeight: "86vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 className="display" style={{ marginBottom: 4 }}>Connect {agentName} to Claude / ChatGPT</h2>
        <p className="text-2" style={{ fontSize: 13.5, marginBottom: 16 }}>Generate a connector token, then add Midas as an MCP server in your AI client. Choose whether this connection can execute approved orders. It always remains scoped to this agent.</p>

        {/* Existing tokens — revoke anytime */}
        {list && list.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <div className="label">Active connector tokens</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {list.map((t: any) => (
                <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px", borderRadius: 8, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{t.label || "AI connector"} <span className="muted mono" style={{ fontSize: 11 }}>· {t.id?.slice(0, 8)}… · {fmtDate(t.created_at || t.createdAt)}</span></span>
                  <button className="btn btn-ghost btn-sm" style={{ color: "var(--red)" }} onClick={() => revoke(t.id)}>Revoke</button>
                </div>
              ))}
            </div>
          </div>
        )}

        <label style={{display:"block",marginBottom:12}}><input type="checkbox" checked={allowExecution} onChange={e=>setAllowExecution(e.target.checked)}/> Allow execution tools (owner approval or mandate still required)</label>
        {!tok ? (
          <button className="btn btn-solid" onClick={gen} disabled={busy}>{busy ? "Generating…" : list && list.length ? "Generate another token" : "Generate connector token"}</button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ padding: 12, borderRadius: 10, background: "var(--gold-soft)", border: "1px solid var(--gold-ring)", fontSize: 12.5 }} className="text-2">
              <strong className="text-gold">Copy this now</strong> — the token is shown only once.
            </div>
            {[["MCP Server URL", tok.url, "url"], ["Token (Bearer / API key)", tok.token, "token"]].map(([label, val, k]) => (
              <div key={k}>
                <div className="label">{label}</div>
                <div style={{ display: "flex", gap: 8 }}>
                  <code className="mono" style={{ flex: 1, fontSize: 12, background: "var(--surface-2)", padding: "8px 10px", borderRadius: 8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</code>
                  <button className="btn btn-outline btn-sm" onClick={() => copy(val as string, k as string)}>{copied === k ? "✓" : "Copy"}</button>
                </div>
              </div>
            ))}
            <div style={{ fontSize: 13, lineHeight: 1.6 }} className="text-2">
              <div style={{ fontWeight: 650, color: "var(--text)", margin: "6px 0 4px" }}>Claude</div>
              Settings → Connectors → Add custom connector → paste the <strong>MCP Server URL</strong>, auth type Bearer, paste the <strong>Token</strong>.
              <div style={{ fontWeight: 650, color: "var(--text)", margin: "10px 0 4px" }}>ChatGPT</div>
              Settings → Connectors (developer mode) → Add → paste the <strong>URL with key</strong> (or URL + Bearer token).
            </div>
          </div>
        )}
        <div style={{ marginTop: 18 }}><button className="btn btn-ghost" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}

// Lightweight Markdown → inline nodes: **bold**, *italic*, `code`, [text](url).
function renderInline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))|(`([^`]+)`)|(\*([^*]+)\*)|(_([^_]+)_)/g;
  let last = 0, mm: RegExpExecArray | null, i = 0;
  while ((mm = re.exec(text))) {
    if (mm.index > last) nodes.push(text.slice(last, mm.index));
    if (mm[2] != null) nodes.push(<strong key={`${keyBase}-${i}`}>{mm[2]}</strong>);
    else if (mm[4] != null) nodes.push(<a key={`${keyBase}-${i}`} href={mm[5]} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>{mm[4]}</a>);
    else if (mm[7] != null) nodes.push(<code key={`${keyBase}-${i}`} className="mono" style={{ background: "var(--surface-2)", padding: "1px 5px", borderRadius: 5, fontSize: "0.92em" }}>{mm[7]}</code>);
    else if (mm[9] != null) nodes.push(<em key={`${keyBase}-${i}`}>{mm[9]}</em>);
    else if (mm[11] != null) nodes.push(<em key={`${keyBase}-${i}`}>{mm[11]}</em>);
    last = mm.index + mm[0].length; i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Markdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ReactNode[] = [];
  let list: ReactNode[] | null = null;
  const flush = () => { if (list) { blocks.push(<ul key={`ul-${blocks.length}`} style={{ margin: "4px 0 10px", paddingLeft: 20, listStyle: "disc" }}>{list}</ul>); list = null; } };
  lines.forEach((ln, idx) => {
    const bullet = ln.match(/^\s*[-*]\s+(.*)$/);
    const heading = ln.match(/^(#{1,4})\s+(.*)$/);
    if (bullet) { (list ??= []).push(<li key={idx} style={{ marginBottom: 3, paddingLeft: 2 }}>{renderInline(bullet[1], `l${idx}`)}</li>); return; }
    flush();
    if (heading) { const lvl = heading[1].length; blocks.push(<div key={idx} className="display" style={{ fontWeight: 700, fontSize: lvl <= 2 ? 17 : 15, margin: "12px 0 4px" }}>{renderInline(heading[2], `h${idx}`)}</div>); return; }
    if (ln.trim() === "") { blocks.push(<div key={idx} style={{ height: 7 }} />); return; }
    blocks.push(<div key={idx} style={{ marginBottom: 5 }}>{renderInline(ln, `p${idx}`)}</div>);
  });
  flush();
  return <>{blocks}</>;
}

function Line({ m, agentId }: { m: Msg; agentId: string }) {
  if (m.role === "user") {
    return (
      <div style={{ marginBottom: 14 }}>
        <span style={{ color: "var(--brand)", fontWeight: 700 }}>❯ </span><span style={{ color: "var(--text)" }}>{m.text}</span>
        {m.images && m.images.length > 0 && (
          <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap", paddingLeft: 16 }}>
            {m.images.map((src, i) => (
              <a key={i} href={src} target="_blank" rel="noreferrer">
                <img src={src} alt="chart" style={{ maxWidth: 220, maxHeight: 150, borderRadius: 10, border: "1px solid var(--border-strong)", display: "block" }} />
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 22 }}>
      {m.proposal && <TradeProposalCard p={m.proposal} agentId={agentId} />}
      {m.swapProposal && <SwapProposalCard p={m.swapProposal} agentId={agentId} />}
      {m.strategyProposal && <StrategyProposalCard p={m.strategyProposal} agentId={agentId} />}
      {m.strategyUpdate && (
        <div className="card" style={{ margin: "4px 0 12px", padding: 14, borderColor: "var(--gold-ring)", background: "var(--gold-soft)" }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}><span className="text-gold">✓ Strategy auto-promoted to v{m.strategyUpdate.version}</span></div>
          <div className="text-2" style={{ fontSize: 13.5 }}>{m.strategyUpdate.reason}</div>
        </div>
      )}
      {m.tools?.map((t, i) => (
        <div key={i} style={{ color: "var(--text-2)", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)" }}>$ </span>
          <span style={{ color: "var(--brand)" }}>{t.name}</span>
          <span className="muted"> {Object.entries(t.args).map(([k, v]) => `--${k} ${v}`).join(" ")}</span>
          <span style={{ marginLeft: 8, color: t.done ? "var(--green)" : "var(--text-muted)" }}>{t.done ? "✓" : <span className="dot-pulse">…</span>}</span>
        </div>
      ))}
      {m.backtest && <BacktestCard r={m.backtest} />}
      <div style={{ color: "var(--text)", lineHeight: 1.65 }}>
        <Markdown text={m.text} />
        {m.streaming && <span style={{ color: "var(--brand)", animation: "blink 1s step-end infinite" }}>▋</span>}
        {m.streaming && !m.text && <span className="muted">running…</span>}
      </div>
    </div>
  );
}

function SwapProposalCard({ p, agentId }: { p: any; agentId: string }) {
  const output = swapOutput(p.tokenOut);
  const outputLabel = p.tokenOutLabel || output.tokenOutLabel;
  const outputNote = p.outputNote || output.outputNote;
  const [state, setState] = useState<"idle" | "executing" | "done" | "rejected">("idle");
  const [result, setResult] = useState<any>(null);
  async function confirm() {
    setState("executing");
    try {
      const r = await api.turnkey.swap(agentId, { tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountIn: p.amountIn, chain: p.chain, slippagePct: p.slippagePct });
      setResult(r); setState("done");
    } catch (e) { setResult({ error: e instanceof Error ? e.message : "failed" }); setState("done"); }
  }
  return (
    <div className="card" style={{ margin: "4px 0 12px", padding: 16, borderColor: "var(--brand-ring)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
        <span className="badge badge-brand">SWAP</span>
        <span className="mono" style={{ fontWeight: 650 }}>{p.amountIn} {String(p.tokenIn).toUpperCase()} → ~{p.buy} {outputLabel}</span>
        <span className="muted mono" style={{ fontSize: 12 }}>{p.chain} · {p.feeTier / 10000}% pool · {p.slippagePct}% slip</span>
      </div>
      {outputNote && <p className="muted" style={{ fontSize: 13, marginBottom: 12 }}>{outputNote}</p>}
      {p.executed && <div className="mono" style={{ fontSize: 13, color: "var(--green)" }}>✓ Submitted{p.swapTx ? <> · <a href={`https://basescan.org/tx/${p.swapTx}`} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>tx</a></> : ""}</div>}
      {!p.executed && state === "idle" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-solid btn-sm" onClick={confirm}>Confirm &amp; swap</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setState("rejected")}>Reject</button>
        </div>
      )}
      {state === "executing" && <div className="muted mono" style={{ fontSize: 13 }}><span className="dot-pulse">●</span> swapping on-chain…</div>}
      {state === "rejected" && <div className="muted" style={{ fontSize: 13 }}>Rejected — no swap made.</div>}
      {state === "done" && (
        <div style={{ fontSize: 13 }} className="mono">
          {result?.placed ? <span style={{ color: "var(--green)" }}>Submitted · quoted ~{result.amountOut} {outputLabel} · <a href={`https://basescan.org/tx/${result.swapTx}`} target="_blank" rel="noreferrer" style={{ color: "var(--brand)", textDecoration: "underline" }}>tx</a></span>
            : result?.blockedByGuardrails ? <span style={{ color: "var(--red)" }}>⚠ Blocked: {result.violations?.join("; ")}</span>
            : <span style={{ color: "var(--red)" }}>✕ {result?.error || "Swap failed"}</span>}
        </div>
      )}
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
      const r = await api.hl.order(agentId, { symbol: p.symbol, side: p.side, quantity: p.quantity, price: p.type === "LIMIT" ? p.price : undefined });
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

function StrategyProposalCard({ p, agentId }: { p: any; agentId: string }) {
  const [state, setState] = useState<"idle" | "approving" | "approved" | "rejected">("idle");
  const m = p.metrics?.challenger ?? {};
  async function approve() {
    setState("approving");
    try { await api.agents.approveStrategy(agentId, p.version); setState("approved"); }
    catch { setState("idle"); }
  }
  return (
    <div className="card" style={{ margin: "4px 0 12px", padding: 16, borderColor: "var(--brand-ring)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
        <span className="badge badge-brand">Strategy update · v{p.version}</span>
        <span className="muted mono" style={{ fontSize: 12 }}>{p.basis} check</span>
      </div>
      {p.thesis && <div style={{ fontSize: 13.5, marginBottom: 8 }}>{p.thesis}</div>}
      <div className="text-2" style={{ fontSize: 13, marginBottom: 10 }}><strong>Rationale:</strong> {p.rationale}</div>
      <div className="mono" style={{ fontSize: 12.5, color: "var(--text-2)", marginBottom: 10 }}>
        Backtest ({p.basis}): Sharpe {m.sharpe ?? "—"} · return {m.totalReturnPct ?? "—"}% · maxDD {m.maxDrawdownPct ?? "—"}% · {m.trades ?? 0} trades · <span style={{ color: p.wins ? "var(--green)" : "var(--red)" }}>{p.verdict}</span>
      </div>
      {state === "idle" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button className="btn btn-solid btn-sm" onClick={approve}>Approve &amp; activate v{p.version}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setState("rejected")}>Keep current</button>
        </div>
      )}
      {state === "approving" && <div className="muted mono" style={{ fontSize: 13 }}><span className="dot-pulse">●</span> activating…</div>}
      {state === "approved" && <div style={{ fontSize: 13, color: "var(--green)" }} className="mono">✓ v{p.version} is now the active strategy.</div>}
      {state === "rejected" && <div className="muted" style={{ fontSize: 13 }}>Kept the current strategy — v{p.version} archived as a proposal.</div>}
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
      <div className="grid-metrics" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginTop: 12 }}>
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

function LimitsModal({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const [cfg, setCfg] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api.agents.riskGet(agentId).then((r: any) => setCfg(r.config)).catch(() => setCfg({})); }, [agentId]);
  function upd(k: string, v: any) { setCfg((c: any) => ({ ...c, [k]: v })); setSaved(false); }
  async function save() { setBusy(true); try { await api.agents.riskSet(agentId, cfg); setSaved(true); } finally { setBusy(false); } }
  async function togglePause() { const v = !cfg.paused; upd("paused", v); await api.agents.riskSet(agentId, { paused: v }).catch(() => {}); }
  const field = (k: string, label: string, hint?: string) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type="number" inputMode="decimal" placeholder="no limit" value={cfg[k] ?? ""} onChange={(e) => upd(k, e.target.value === "" ? null : Number(e.target.value))} />
      {hint && <div className="muted" style={{ fontSize: 11, marginTop: 4 }}>{hint}</div>}
    </div>
  );
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 200, padding: 16 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: "100%", maxHeight: "88vh", overflowY: "auto" }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginBottom: 6 }}>Risk & limits</h2>
        <p className="text-2" style={{ fontSize: 13, marginBottom: 16 }}>Enforced server-side on every trade for this agent — including autonomous / cron runs. Leave a field blank for &ldquo;no limit&rdquo;.</p>
        {!cfg ? <p className="muted">Loading…</p> : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: "var(--surface-2)", border: `1px solid ${cfg.paused ? "var(--red)" : "var(--border)"}` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 650 }}>Kill switch</div>
                <div className="muted" style={{ fontSize: 12 }}>Halt all trading for this agent immediately.</div>
              </div>
              <button onClick={togglePause} className={`badge ${cfg.paused ? "badge-soft" : "badge-on"}`} style={{ height: 30, padding: "0 14px", cursor: "pointer", border: "none", color: cfg.paused ? "var(--red)" : undefined }}>{cfg.paused ? "PAUSED" : "Active"}</button>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: 12, borderRadius: 12, background: "var(--surface-2)", border: "1px solid var(--border)" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 650 }}>Auto-execute</div>
                <div className="muted" style={{ fontSize: 12 }}>Place trades without a confirm tap (still capped by the limits below).</div>
              </div>
              <button onClick={() => { const v = !cfg.autoExecute; upd("autoExecute", v); api.agents.riskSet(agentId, { autoExecute: v }).catch(() => {}); }} className={`badge ${cfg.autoExecute ? "badge-on" : "badge-soft"}`} style={{ height: 30, padding: "0 14px", cursor: "pointer", border: "none" }}>{cfg.autoExecute ? "ON" : "OFF"}</button>
            </div>
            {field("maxNotionalUsd", "Max notional per trade ($)")}
            {field("maxLeverage", "Max leverage (×)")}
            {field("maxRiskPerTradePct", "Max risk per trade (%)")}
            {field("maxTradesPerDay", "Max trades per day")}
            {field("dailyLossLimitUsd", "Daily loss limit ($)", "Perps: halts trading once today's realized PnL drops below this.")}
            <div style={{ display: "flex", gap: 10, marginTop: 4 }}>
              <button className="btn btn-solid" onClick={save} disabled={busy}>{busy ? "Saving…" : saved ? "Saved ✓" : "Save limits"}</button>
              <button className="btn btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
