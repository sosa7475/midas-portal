"use client";
import {useEffect,useState,useCallback} from "react";
import Link from "next/link";
import {TradingOperations} from "../components/TradingOperations";
import {formatUnits} from "viem";

async function api(url:string,body?:unknown,method="POST") {
 const r=await fetch(url,body===undefined?undefined:{method,headers:{"content-type":"application/json"},body:JSON.stringify(body)});
 const data=await r.json();if(!r.ok||data.error)throw Error(data.error||"Request failed");return data;
}
export default function TradingControl() {
 const [agents,setAgents]=useState<any[]>([]),[agentId,setAgentId]=useState(""),[chain,setChain]=useState("robinhood");
 const [ownerAddress,setOwnerAddress]=useState(""),[apiKey,setApiKey]=useState(""),[network,setNetwork]=useState("mainnet"),[runState,setRunState]=useState<any>(null);
 const [orders,setOrders]=useState<any[]>([]),[wallet,setWallet]=useState<any>(null),[error,setError]=useState(""),[busy,setBusy]=useState(false);
 const [tokenIn,setTokenIn]=useState("eth"),[tokenOut,setTokenOut]=useState(""),[amount,setAmount]=useState(""),[slippage,setSlippage]=useState("0.5");
 const [stopPct,setStopPct]=useState("10"),[targetPct,setTargetPct]=useState("20");
 const [mandate,setMandate]=useState<any>(null),[assets,setAssets]=useState(""),[maxOrder,setMaxOrder]=useState("5"),[turnover,setTurnover]=useState("10"),[version,setVersion]=useState("1"),[reserve,setReserve]=useState("0.0001"),[gas,setGas]=useState("0.0001"),[expiry,setExpiry]=useState("");
 const refresh=useCallback(async()=>{
  if(!agentId)return;
  try{const [o,w,m,runs]=await Promise.all([api(`/api/execution?agentId=${agentId}`),api(`/api/venues?agentId=${agentId}&chain=${chain}`),api(`/api/mandate?agentId=${agentId}`),api(`/api/agent-runs?agentId=${agentId}`)]);setRunState(runs);setOrders(o.orders);setWallet(w);setMandate(m.mandate);setError("");}
  catch(e){setError(e instanceof Error?e.message:"Could not load trading status");}
 },[agentId,chain]);
 useEffect(()=>{api("/api/agents").then(b=>{setAgents(b.agents);const selected=new URLSearchParams(location.search).get("agentId");setAgentId(selected??b.agents[0]?.id??"");}).catch(e=>setError(e.message));},[]);
 useEffect(()=>{void refresh();const t=setInterval(refresh,15000);return()=>clearInterval(t);},[refresh]);
 async function action(fn:()=>Promise<unknown>){if(busy)return;setBusy(true);setError("");try{await fn();await refresh();}catch(e){setError(e instanceof Error?e.message:"Request failed");}finally{setBusy(false);}}
 async function saveMandate(enabled:boolean) {
  const m=enabled?{enabled:true,venues:[chain],assets:assets.split(",").map(s=>s.trim()).filter(Boolean),maxOrderUsd:Number(maxOrder),maxDailyTurnoverUsd:Number(turnover),maxLeverage:1,spotExit:{stopLossPct:Number(stopPct),takeProfitPct:Number(targetPct),maxHoldingSeconds:86400},maxSlippageBps:Math.round(Number(slippage)*100),gasReserveEth:reserve,maxGasEth:gas,strategyVersion:Number(version),expiresAt:new Date(expiry).toISOString()}:{...mandate,enabled:false};
  await api("/api/mandate",{agentId,mandate:m},"PUT");
 }
 return <main style={{maxWidth:1100,margin:"0 auto",padding:24}}>
  <h1>Trading control</h1><p>Review exact orders, connect your agent’s funds, and define what it may trade automatically.</p>
  <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:20}}>
   <label>Agent <select value={agentId} onChange={e=>setAgentId(e.target.value)}>{agents.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
   <label>Network <select value={chain} onChange={e=>setChain(e.target.value)}><option value="robinhood">Robinhood Chain</option><option value="base">Base</option></select></label>
   <button className="btn btn-outline" onClick={refresh} disabled={busy}>Refresh</button>
  </div>
  {error&&<p role="alert" style={{color:"var(--red)"}}>{error}</p>}
  <TradingOperations agentId={agentId} chain={chain}/>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Wallet on {chain==="robinhood"?"Robinhood Chain":"Base"}</h2>
   {wallet?.connected?<><p style={{overflowWrap:"anywhere"}}>{wallet.address}</p><p>{wallet.eth} ETH available for trades and gas.</p>{wallet.tokens?.map((t:any)=><p key={t.address} style={{overflowWrap:"anywhere"}}>{t.balance??"Unavailable"} · {t.address}</p>)}<p>Inventory may omit untracked tokens. Send funds only on this selected network.</p></>:<p><Link href="/wallet">Create an agent wallet</Link> to receive funds on this network.</p>}
  </section>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Prepare a swap</h2><p>Use token contract addresses on the selected network. ETH output is received as WETH. Preparing an order does not submit it.</p>
   <form onSubmit={e=>{e.preventDefault();void action(()=>api("/api/execution",{agentId,action:"propose",kind:"swap",terms:{chain,tokenIn,tokenOut,amountIn:amount,slippagePct:Number(slippage),requestKey:crypto.randomUUID()}}));}} style={{display:"grid",gap:12}}>
    <label>Sell <input required value={tokenIn} onChange={e=>setTokenIn(e.target.value)} placeholder="eth or token address"/></label>
    <label>Buy <input required value={tokenOut} onChange={e=>setTokenOut(e.target.value)} placeholder="Token contract address"/></label>
    <label>Amount <input required inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)}/></label>
    <label>Maximum slippage (%) <input type="number" min="0" max="3" step="0.01" required value={slippage} onChange={e=>setSlippage(e.target.value)}/></label>
    <button className="btn btn-solid" disabled={busy||!agentId}>Get proposal</button>
   </form>
  </section>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Orders and approvals</h2>
   {!orders.length&&<p>No orders yet.</p>}
   {orders.map(o=><article key={o.id} style={{borderTop:"1px solid var(--border)",padding:"16px 0"}}>
    <strong>{o.kind} · {o.payload.chain??"Hyperliquid"} · {o.status}</strong>
    <p style={{overflowWrap:"anywhere"}}>{o.payload.amountInHuman??o.payload.quantity} {o.payload.tokenIn??o.payload.symbol} {o.kind==="swap"?`→ ${o.payload.tokenOut}`:o.payload.side}</p>
    <p>Slippage: {o.payload.slippagePct}% · Value: {o.payload.notionalUsd==null?"unverified":`$${o.payload.notionalUsd.toFixed(2)}`} · Expires: {new Date(o.expires_at).toLocaleString()}</p>
    {o.payload.minimumOutRaw&&<p>Minimum received: {formatUnits(BigInt(o.payload.minimumOutRaw),o.payload.decimalsOut)} tokens</p>}
    <p style={{overflowWrap:"anywhere"}}>Trading account: {o.payload.account}</p>
    {o.kind==="swap"&&<p>Network fee budget: {o.payload.maxGasEth} ETH · Keep: {o.payload.gasReserveEth} ETH. Base data-fee estimates may change before inclusion.</p>}
    {o.payload.exitPlan&&<p>Automatic exit on received tokens: stop {o.payload.exitPlan.stopLossPct}% below entry cost; target {o.payload.exitPlan.takeProfitPct??"none"}%; time exit after {o.payload.exitPlan.maxHoldingSeconds/3600} hours, with five minutes to submit. Exits remain authorized separately from entry permissions.</p>}
    {o.payload.stopLoss&&<p>Stop: {o.payload.stopLoss}</p>}{o.payload.takeProfit&&<p>Target: {o.payload.takeProfit}</p>}
    {o.payload.orderId&&<p>Cancel venue order: {o.payload.orderId}</p>}
    {o.status==="proposed"&&Date.parse(o.expires_at)>Date.now()&&<div style={{display:"flex",gap:8}}><button disabled={busy} className="btn btn-solid" onClick={()=>action(()=>api("/api/execution",{agentId,orderId:o.id,action:"approve"}))}>Approve & execute</button><button disabled={busy} className="btn btn-outline" onClick={()=>action(()=>api("/api/execution",{agentId,orderId:o.id,action:"reject"}))}>Reject</button></div>}
    {o.kind==="swap"&&["unknown","submitting"].includes(o.status)&&Date.parse(o.expires_at)<=Date.now()&&<button disabled={busy} onClick={()=>action(()=>api("/api/execution",{agentId,orderId:o.id,action:"recover"}))}>Check approval-only recovery</button>}
    {o.error&&<p role="alert">{o.error}. Check status before creating another order.</p>}
    {o.transactions?.map((t:any)=><p key={t.hash} style={{overflowWrap:"anywhere"}}>{t.stage}: {t.hash}</p>)}
   </article>)}
  </section>
  <section className="card" style={{padding:20,marginBottom:20}}><h2>Scheduled agent</h2>
   <p>The server worker must be deployed for scheduled runs. Research and execution use the same permission checks as connected agents.</p>
   <button className="btn btn-outline" disabled={busy} onClick={()=>action(()=>api("/api/agent-runs",{agentId,enabled:!runState?.schedule?.enabled,intervalSeconds:1800},"PUT"))}>{runState?.schedule?.enabled?"Pause scheduled runs":"Enable every 30 minutes"}</button>
   {runState?.runs?.map((r:any)=><p key={r.id}>{new Date(r.started_at).toLocaleString()} · {r.status} · {r.summary??r.error}</p>)}
  </section>
  <details className="card" style={{padding:20,marginBottom:20}}><summary>Connect a Hyperliquid account</summary>
   <p>Approve a dedicated API wallet in Hyperliquid, then enter its private key here. Use the account holding the funds as the owner address. Never enter your owner wallet key or seed phrase.</p>
   <form style={{display:"grid",gap:12}} onSubmit={e=>{e.preventDefault();void action(async()=>{try{await api("/api/hl/connect",{agentId,ownerAddress,agentPrivateKey:apiKey,network});}finally{setApiKey("");}});}}>
    <label>Account address <input required value={ownerAddress} onChange={e=>setOwnerAddress(e.target.value)}/></label>
    <label>API wallet private key <input type="password" autoComplete="off" required value={apiKey} onChange={e=>setApiKey(e.target.value)}/></label>
    <label>Network <select value={network} onChange={e=>setNetwork(e.target.value)}><option value="mainnet">Mainnet</option><option value="testnet">Testnet</option></select></label>
    <button className="btn btn-solid" disabled={busy}>Verify and connect</button>
   </form>
  </details>
  <section className="card" style={{padding:20}}><h2>Autonomous mandate</h2>
   <p>{mandate?.enabled?`Enabled until ${new Date(mandate.expiresAt).toLocaleString()}`:"No enabled mandate"}. Automatic execution also requires the agent’s auto-execute setting and a qualified strategy. Transfers and bridging are excluded.</p>
   {mandate?.enabled&&<button className="btn btn-outline" disabled={busy} onClick={()=>action(()=>saveMandate(false))}>Revoke mandate</button>}
   <form onSubmit={e=>{e.preventDefault();void action(()=>saveMandate(true));}} style={{display:"grid",gap:12,marginTop:16}}>
    <label>Allowed token contracts, separated by commas <input required value={assets} onChange={e=>setAssets(e.target.value)}/></label>
    <label>Maximum order ($) <input required type="number" min="0.01" step="0.01" value={maxOrder} onChange={e=>setMaxOrder(e.target.value)}/></label>
    <label>Maximum daily turnover ($) <input required type="number" min="0.01" step="0.01" value={turnover} onChange={e=>setTurnover(e.target.value)}/></label>
    <label>Spot-entry stop loss (%) <input required type="number" min="0.1" max="50" step="0.1" value={stopPct} onChange={e=>setStopPct(e.target.value)}/></label>
    <label>Spot-entry take profit (%) <input required type="number" min="0.1" max="1000" step="0.1" value={targetPct} onChange={e=>setTargetPct(e.target.value)}/></label>
    <p>Spot exits use actual received tokens and entry-token proceeds; time exits trigger 24 hours after each fill, with a five-minute execution window. A trigger cannot guarantee a fill.</p>
    <label>Qualified strategy version <input required type="number" min="1" value={version} onChange={e=>setVersion(e.target.value)}/></label>
    <label>Keep ETH for gas <input required value={reserve} onChange={e=>setReserve(e.target.value)}/></label>
    <label>Maximum ETH gas budget per order <input required value={gas} onChange={e=>setGas(e.target.value)}/></label>
    <label>Expires <input type="datetime-local" required value={expiry} onChange={e=>setExpiry(e.target.value)}/></label>
    <button className="btn btn-solid" disabled={busy||!agentId}>Authorize mandate for {chain==="robinhood"?"Robinhood Chain":"Base"}</button>
   </form>
  </section>
 </main>;
}
