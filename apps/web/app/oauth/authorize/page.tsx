"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "../../../lib/api";
import { BrandMark } from "../../components/BrandMark";

export default function Authorize() {
  return <Suspense fallback={null}><AuthorizeInner /></Suspense>;
}

function AuthorizeInner() {
  const sp = useSearchParams();
  const [agents, setAgents] = useState<any[] | null>(null);
  const [agentId, setAgentId] = useState("");
  const [allowExecution,setAllowExecution]=useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clientId = sp.get("client_id") || "";
  const redirectUri = sp.get("redirect_uri") || "";
  const state = sp.get("state") || "";
  const codeChallenge = sp.get("code_challenge") || "";

  useEffect(() => {
    api.agents.list()
      .then((r) => { setAgents(r.agents || []); if (r.agents?.[0]) setAgentId(r.agents[0].id); })
      .catch(() => { window.location.href = `/login?next=${encodeURIComponent(location.pathname + location.search)}`; });
  }, []);

  async function authorize() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/oauth/approve", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ client_id: clientId, redirect_uri: redirectUri, state, code_challenge: codeChallenge, agentId, scopes:["read","research","propose",...(allowExecution?["execute"]:[])] }) });
      const d = await r.json();
      if (d.redirect) window.location.href = d.redirect;
      else { setError(d.error || "Authorization failed"); setBusy(false); }
    } catch (e) { setError(e instanceof Error ? e.message : "failed"); setBusy(false); }
  }
  function deny() { if (redirectUri) window.location.href = `${redirectUri}${redirectUri.includes("?") ? "&" : "?"}error=access_denied${state ? `&state=${encodeURIComponent(state)}` : ""}`; }

  const badRequest = !clientId || !redirectUri || !codeChallenge;

  return (
    <main style={{ minHeight: "100dvh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div className="card" style={{ width: 440, maxWidth: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}><BrandMark height={30} /><span className="display" style={{ fontWeight: 800, fontSize: 18 }}>Midas</span></div>
        {badRequest ? (
          <p className="text-2">Invalid authorization request — missing parameters.</p>
        ) : (
          <>
            <h1 style={{ fontSize: 20, marginBottom: 6 }}>Authorize connection</h1>
            <p className="text-2" style={{ fontSize: 14, marginBottom: 18 }}>An AI client wants to connect to one of your Midas agents — its analysis, strategy, live wallet, and trading tools. Choose which agent to grant.</p>
            {agents === null ? <p className="muted">Loading…</p> : agents.length === 0 ? (
              <p className="text-2">You have no agents yet. Create one first, then re-try the connection.</p>
            ) : (
              <>
                <label className="label">Agent to connect</label>
                <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)} style={{ marginBottom: 16 }}>
                  {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
                <label style={{display:"block",marginBottom:16}}><input type="checkbox" checked={allowExecution} onChange={e=>setAllowExecution(e.target.checked)}/> Allow execution tools. Each order still needs owner approval or an active mandate.</label>
                {error && <p style={{ color: "var(--red)", fontSize: 13, marginBottom: 10 }}>{error}</p>}
                <div style={{ display: "flex", gap: 10 }}>
                  <button className="btn btn-solid" style={{ flex: 1 }} onClick={authorize} disabled={busy || !agentId}>{busy ? "Authorizing…" : "Authorize"}</button>
                  <button className="btn btn-outline" onClick={deny}>Deny</button>
                </div>
                <p className="muted" style={{ fontSize: 11.5, marginTop: 12 }}>You can revoke this anytime in the agent&apos;s Connect AI panel.</p>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
