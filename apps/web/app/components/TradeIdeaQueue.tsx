"use client";
import { useCallback, useEffect, useState } from "react";
export function TradeIdeaQueue({agentId}:{agentId:string}) {
  const [ideas,setIdeas]=useState<any[]>([]),[error,setError]=useState(""),[busy,setBusy]=useState<string|null>(null);
  const url=`/api/agents/${encodeURIComponent(agentId)}/trade-ideas`;
  const refresh=useCallback(async()=>{
    try{const r=await fetch(url);const b=await r.json();if(!r.ok)throw Error(b.error||"Could not load ideas");setIdeas(b.ideas||[]);setError("");}
    catch(e){setError(e instanceof Error?e.message:"Could not load ideas");}
  },[url]);
  useEffect(()=>{void refresh();const timer=setInterval(refresh,30000);return()=>clearInterval(timer);},[refresh]);
  async function act(id:string,method:"POST"|"DELETE") {
    if(busy)return;setBusy(id);
    try{const r=await fetch(url,{method,headers:{"content-type":"application/json"},body:JSON.stringify({ideaId:id})});const b=await r.json();await refresh();if(b.persistenceWarning)setError(b.persistenceWarning);if(!r.ok||b.placed===false)throw Error(b.error||b.violations?.join("; ")||"Idea needs review; check transaction history before retrying");}
    catch(e){setError(e instanceof Error?e.message:"Status unknown; check transaction history");}finally{setBusy(null);}
  }
  return <section className="card" style={{marginBottom:16,padding:16}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:12}}><strong>Trade ideas to review</strong><button className="btn btn-ghost btn-sm" onClick={refresh}>Refresh</button></div>
    <p className="muted">Ideas in this queue require your review and click. Exit plans are instructions to review, not automatic orders.</p>
    {error&&<p role="alert" style={{color:"var(--red)"}}>{error}</p>}
    {!ideas.length&&<p className="muted">No trade ideas yet.</p>}
    {ideas.map(row=>{const p=row.proposal;const pending=row.status==="pending_review"&&Date.parse(row.expires_at)>Date.now();return <article key={row.id} style={{borderTop:"1px solid var(--border)",paddingTop:12,marginTop:12}}>
      <strong>{p.amountIn} {p.tokenIn} → approximately {p.buy} {p.tokenOutLabel}</strong>
      <p>Minimum received: {p.minOut} {p.tokenOutLabel} · Slippage: {p.slippagePct}%</p>
      {p.outputNote&&<p>{p.outputNote}</p>}<p className="muted">{p.costNote}</p>
      <p><b>Why:</b> {p.rationale}</p><p><b>Exit plan:</b> {p.exitPlan}</p><p><b>Discard when:</b> {p.invalidation}</p>
      <details><summary>Evidence and strategy</summary><p>{p.strategyVersion}</p><p>{p.evidence}</p></details>
      <p className="muted">{row.status} · Expires {new Date(row.expires_at).toLocaleString()}</p>
      {pending&&<div style={{display:"flex",gap:8}}><button disabled={busy!==null} className="btn btn-solid btn-sm" onClick={()=>act(row.id,"POST")}>{busy===row.id?"Submitting…":"Confirm & submit"}</button><button disabled={busy!==null} className="btn btn-ghost btn-sm" onClick={()=>act(row.id,"DELETE")}>Reject</button></div>}
      {row.result?.swapTx&&(p.chain==="robinhood"?<p style={{overflowWrap:"anywhere"}}>Robinhood Chain transaction: {row.result.swapTx}</p>:<a href={`https://basescan.org/tx/${row.result.swapTx}`} target="_blank" rel="noreferrer">View submitted transaction</a>)}
      {row.result?.error&&<p role="alert">{row.result.error}</p>}
    </article>})}
  </section>;
}
