"use client";

import { use, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { api, streamChat } from "../../../lib/api";
import { useAuth } from "../../../lib/useAuth";
import { mcpById } from "../../../lib/mcps";

interface Msg {
  role: "user" | "agent";
  text: string;
  tools?: { name: string; args: any }[];
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
    if (ready) api.agents.get(id).then((r) => setAgent(r.agent)).catch(() => setAgent(false));
  }, [ready, id]);

  useEffect(() => { scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight); }, [messages]);

  if (!ready) return null;
  if (agent === false) return <main className="container" style={{ paddingTop: 40 }}><p>Agent not found. <Link href="/agents" style={{ color: "var(--brand)" }}>Back to My Agents</Link></p></main>;

  function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", text }, { role: "agent", text: "", tools: [], streaming: true }]);

    streamChat(text, (e) => {
      setMessages((m) => {
        const copy = [...m];
        const last = copy[copy.length - 1];
        if (last?.role !== "agent") return m;
        if (e.type === "tool") last.tools = [...(last.tools ?? []), { name: e.name, args: e.args }];
        else if (e.type === "delta") last.text += e.content;
        else if (e.type === "error") { last.text += `\n\n_(${e.error})_`; last.streaming = false; setBusy(false); }
        else if (e.type === "done") { last.streaming = false; setBusy(false); }
        return copy;
      });
    }, id);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>
      {/* agent header */}
      <div style={{ borderBottom: "1px solid var(--border)", padding: "14px 24px", display: "flex", alignItems: "center", gap: 12 }}>
        <Link href="/agents" className="btn btn-ghost btn-sm">‹</Link>
        <span style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#e2622f,#f2913f)", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontWeight: 700 }}>{agent ? agent.name.slice(0, 1).toUpperCase() : "…"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 650 }}>{agent?.name ?? "Loading…"}</div>
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            {(agent?.mcps ?? []).map((mid: string) => <span key={mid} className="badge badge-soft" style={{ height: 18, fontSize: 11 }}>{mcpById(mid)?.icon} {mcpById(mid)?.name}</span>)}
          </div>
        </div>
      </div>

      {/* transcript */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>
          {messages.length === 0 && (
            <div className="card-flat" style={{ textAlign: "center", padding: 32 }}>
              <div style={{ fontSize: 26, marginBottom: 8 }}>💬</div>
              <p className="text-2">Ask {agent?.name ?? "your agent"} anything — try <em>&quot;analyze BTC on the 4h and tell me if a long fits my strategy&quot;</em></p>
            </div>
          )}
          {messages.map((m, i) => <MessageBubble key={i} m={m} />)}
        </div>
      </div>

      {/* composer */}
      <div style={{ padding: "14px 24px 24px" }}>
        <div style={{ maxWidth: 760, margin: "0 auto", display: "flex", gap: 10, alignItems: "flex-end", background: "var(--surface)", border: "1px solid var(--border-strong)", borderRadius: 16, padding: 8 }}>
          <textarea
            className="textarea"
            style={{ border: "none", minHeight: 24, maxHeight: 160, padding: "8px 10px", boxShadow: "none", flex: 1 }}
            placeholder={`Message ${agent?.name ?? "agent"}…`}
            value={input}
            rows={1}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          />
          <button className="btn btn-solid" style={{ height: 40, width: 40, padding: 0, borderRadius: 12 }} onClick={send} disabled={busy}>↑</button>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ m }: { m: Msg }) {
  if (m.role === "user") {
    return <div style={{ alignSelf: "flex-end", maxWidth: "80%", background: "var(--brand-soft)", border: "1px solid #f0d9cc", borderRadius: 14, padding: "10px 15px" }}>{m.text}</div>;
  }
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <span style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#e2622f,#f2913f)", flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 13, fontWeight: 700 }}>M</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        {m.tools?.map((t, i) => (
          <div key={i} className="mono" style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-2)", background: "var(--surface-2)", border: "1px solid var(--border)", borderRadius: 8, padding: "5px 10px", marginBottom: 8, marginRight: 8 }}>
            <span style={{ color: "var(--brand)" }}>{"›_"}</span> {t.name}({Object.values(t.args).join(", ")})
          </div>
        ))}
        <div style={{ whiteSpace: "pre-wrap", lineHeight: 1.7 }}>
          {m.text}
          {m.streaming && (m.text ? <span className="dot-pulse">▋</span> : <span className="muted dot-pulse">thinking…</span>)}
        </div>
      </div>
    </div>
  );
}
