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

  useEffect(() => { if (ready) api.agents.get(id).then((r) => setAgent(r.agent)).catch(() => setAgent(false)); }, [ready, id]);
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
          {messages.map((m, i) => <Line key={i} m={m} />)}
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

function Line({ m }: { m: Msg }) {
  if (m.role === "user") {
    return <div style={{ marginBottom: 14 }}><span style={{ color: "var(--brand)", fontWeight: 700 }}>❯ </span><span style={{ color: "var(--text)" }}>{m.text}</span></div>;
  }
  return (
    <div style={{ marginBottom: 22 }}>
      {m.tools?.map((t, i) => (
        <div key={i} style={{ color: "var(--text-2)", marginBottom: 4 }}>
          <span style={{ color: "var(--text-muted)" }}>$ </span>
          <span style={{ color: "var(--brand)" }}>{t.name}</span>
          <span className="muted"> {Object.entries(t.args).map(([k, v]) => `--${k} ${v}`).join(" ")}</span>
          <span style={{ marginLeft: 8, color: t.done ? "var(--green)" : "var(--text-muted)" }}>{t.done ? "✓" : <span className="dot-pulse">…</span>}</span>
        </div>
      ))}
      <div style={{ whiteSpace: "pre-wrap", color: "var(--text)" }}>
        {m.text}
        {m.streaming && <span style={{ color: "var(--brand)", animation: "blink 1s step-end infinite" }}>▋</span>}
        {m.streaming && !m.text && <span className="muted">running…</span>}
      </div>
    </div>
  );
}
