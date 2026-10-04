"use client";
import {useState,useEffect,useCallback} from "react";
import {formatUnits} from "viem";
async function request(path:string,body?:unknown,method="POST"){
 const r=await fetch(path,body===undefined?undefined:{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});const d=await r.json();if(!r.ok||d.error)throw Error(d.error??"Request failed");return d;
}
export function TradingOperations({agentId,chain}:{agentId:string;chain:string}){
 const [password,setPassword]=useState(""),[verified,setVerified]=useState(false);
 const [status,setStatus]=useState<any>(null),[rules,setRules]=useState<any[]>([]),[error,setError]=useState("");
 const [busy,setBusy]=useState(false),[tokenIn,setTokenIn]=useState(""),[tokenOut,setTokenOut]=useState(""),[amount,setAmount]=useState(""),[stop,setStop]=useState(""),[target,setTarget]=useState(""),[expiry,setExpiry]=useState(""),[gas,setGas]=useState("0.0001"),[reserve,setReserve]=useState("0.0001"),[slippage,setSlippage]=useState("0.5");
 const refresh=useCallback(async()=>{
  if(!agentId)return;const results=await Promise.allSettled([request(`/api/operations?agentId=${agentId}`),request(`/api/spot-exits?agentId=${agentId}`)]);
  if(results[0].status==="fulfilled")setStatus(results[0].value);else setError("Trading readiness unavailable");
  if(results[1].status==="fulfilled")setRules(results[1].value.rules);else setError("Exit-rule status unavailable");
 },[agentId]);
 useEffect(()=>{setStatus(null);setRules([]);void refresh();const timer=setInterval(refresh,15000);return()=>clearInterval(timer);},[refresh]);
 async function action(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:"Action failed");}finally{setBusy(false);}}
 return <>
  <details className="card" style={{padding:20,marginBottom:20}}><summary>Confirm account ownership for sensitive changes</summary><p>Re-enter your password to authorize new exit rules, trading permissions or custody changes for ten minutes. Pausing and revoking permissions remain available.</p><form onSubmit={e=>{e.preventDefault();void action(async()=>{try{await request("/api/auth/reauthenticate",{password});setVerified(true);}finally{setPassword("");}});}}><input aria-label="Account password" autoComplete="current-password" type="password" required value={password} onChange={e=>setPassword(e.target.value)}/><button disabled={busy}>Verify</button>{verified&&<p>Verified. Sensitive changes are unlocked for ten minutes.</p>}</form></details>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Readiness and alerts</h2>
   {!status?<p>Checking service health…</p>:<><p>{status.automaticEntriesEligible?"Automatic entry checks pass; each trade is checked again before signing.":"Automatic entries are not ready."}</p>
   <ul>{status.blockers?.map((b:string)=><li key={b}>{b}</li>)}</ul>
   <p>Hyperliquid: {status.account?.hyperliquid?.network??"not connected"}. Company fundamentals: {status.providers?.finnhub?"configured":"provider key required"}.</p>
   {status.operations?.alerts?.map((a:any)=><article key={a.id} style={{borderTop:"1px solid var(--border)",padding:10}}><strong>{a.severity}</strong> · {a.message}<br/><button disabled={busy} onClick={()=>action(()=>request("/api/operations",{id:a.id}))}>Acknowledge</button></article>)}
   </>}
   {error&&<p role="alert">{error}</p>}
  </section>
  <details className="card" style={{padding:20,marginBottom:20}}><summary>Authorize a spot exit on {chain==="robinhood"?"Robinhood Chain":"Base"}</summary>
   <p>This rule sells a fixed amount you already hold when its quoted total proceeds reach your stop or target. It runs separately from AI research. A stop is a trigger, not a guaranteed execution price; network outages or poor liquidity may prevent a sale. Revocation cannot recall a broadcast transaction.</p>
   <form style={{display:"grid",gap:12}} onSubmit={e=>{e.preventDefault();void action(()=>request("/api/spot-exits",{agentId,rule:{chain,tokenIn,tokenOut,amount,stopOutput:stop,...(target?{targetOutput:target}:{}),slippagePct:Number(slippage),gasReserveEth:reserve,maxGasEth:gas,expiresAt:new Date(expiry).toISOString()}}));}}>
    <label>Sell token contract <input required value={tokenIn} onChange={e=>setTokenIn(e.target.value)}/></label>
    <label>Receive WETH or supported USDC contract <input required value={tokenOut} onChange={e=>setTokenOut(e.target.value)}/></label>
    <label>Fixed amount to sell <input required value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Stop: sell when total quoted proceeds fall to <input required value={stop} onChange={e=>setStop(e.target.value)}/></label>
    <label>Target: sell when total quoted proceeds rise to (optional) <input value={target} onChange={e=>setTarget(e.target.value)}/></label>
    <p>Both thresholds are in receive-token units for the entire amount, not a dollar price per token.</p>
    <label>Maximum slippage (%) <input required type="number" min="0" max="3" step="0.01" value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
    <label>Network fee budget (ETH) <input required value={gas} onChange={e=>setGas(e.target.value)}/></label>
    <label>Keep ETH for future gas <input required value={reserve} onChange={e=>setReserve(e.target.value)}/></label>
    <label>Authorization expires (within 30 days) <input required type="datetime-local" value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
    <button disabled={busy||!agentId} className="btn btn-solid">Authorize automatic exit</button>
   </form>
  </details>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Spot exit rules</h2>
   {!rules.length&&<p>No authorized exits.</p>}
   {rules.map(r=><article key={r.id} style={{overflowWrap:"anywhere",borderTop:"1px solid var(--border)",padding:12}}><strong>{r.chain} · {r.status}</strong><p>Sell {formatUnits(BigInt(r.amount_raw),r.decimals_in)} of {r.token_in}. Receive {r.token_out}.</p><p>Stop proceeds: {formatUnits(BigInt(r.stop_out_raw),r.decimals_out)}. Target: {r.target_out_raw?formatUnits(BigInt(r.target_out_raw),r.decimals_out):"none"}.</p>{r.exit_at&&<p>Time exit: {new Date(r.exit_at).toLocaleString()}</p>}<p>Expires {new Date(r.expires_at).toLocaleString()}</p>{r.last_error&&<p role="alert">{r.last_error}</p>}{["armed","executing","review_required"].includes(r.status)&&<button disabled={busy} onClick={()=>action(()=>request("/api/spot-exits",{agentId,id:r.id},"DELETE"))}>Revoke exit</button>}</article>)}
  </section>
 </>;
}
