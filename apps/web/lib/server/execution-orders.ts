import {attachFilledExit} from "./attached-exit";
import {checkExitRule} from "./spot-exit-policy";
import { randomUUID } from "node:crypto";
import { query, transaction } from "./db";
import { getMandate, checkMandate, mandateSchema } from "./mandate";
import { getRisk, RISK_DEFAULTS } from "./agent-risk-sql";
import { getActiveStrategy } from "./strategy-sql";
import { judge } from "./strategy-review";

export interface Scope {userId:string;agentId:string;runId?:string;connectorId?:string}
export async function createExecution(ctx:Scope,kind:string,accountKey:string,payload:any,requestKey?:string) {
 const key=requestKey??randomUUID();
 if(key.length>120)throw new Error("Request key too long");
 const r=await query(`INSERT INTO execution_orders(user_id,agent_id,request_key,kind,account_key,payload,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,LEAST(NOW()+INTERVAL '3 minutes',to_timestamp($7/1000.0))) ON CONFLICT(user_id,agent_id,request_key) DO NOTHING RETURNING *`,[ctx.userId,ctx.agentId,key,kind,accountKey,JSON.stringify(payload),payload.validUntilMs??Date.now()+180000]);
 const row=r.rows[0]??(await query("SELECT * FROM execution_orders WHERE user_id=$1 AND agent_id=$2 AND request_key=$3",[ctx.userId,ctx.agentId,key])).rows[0];
 if(JSON.stringify(row.payload)!==JSON.stringify(JSON.parse(JSON.stringify(payload)))) {
   // JSONB does not preserve object key order.
   const canonical=(v:any):string=>JSON.stringify(v===null||typeof v!=="object"?v:Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])));
   if(canonical(row.payload)!==canonical(payload))throw new Error("Request key already used for different terms");
 }
 return row;
}
export async function listExecutions(ctx:Scope) {return (await query("SELECT * FROM execution_orders WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 100",[ctx.userId,ctx.agentId])).rows;}
export async function approveExecution(ctx:Scope,id:string) {
 const r=await query("UPDATE execution_orders SET approval='owner',approved_at=NOW(),status='approved' WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND status='proposed' AND expires_at>NOW() RETURNING id",[id,ctx.userId,ctx.agentId]);
 if(!r.rows.length)throw new Error("Order expired or already handled");
}
export async function recordTransaction(id:string,stage:string,hash:string) {
 const recorded=await query("UPDATE execution_orders SET transactions=transactions || $2::jsonb,updated_at=NOW() WHERE id=$1 AND status='submitting' AND expires_at>NOW() RETURNING id",[id,JSON.stringify([{stage,hash}])]);
 if(!recorded.rows.length)throw Error("Reservation expired or recovered before broadcast");
 await query("INSERT INTO execution_events(order_id,kind,data) VALUES($1,'transaction',$2)",[id,JSON.stringify({stage,hash})]);
}
export async function recordVenueSubmission(id:string) {
 await query("INSERT INTO execution_events(order_id,kind,data) VALUES($1,'venue_submission','{}')",[id]);
}
export async function recheckAuthorization(ctx:Scope,id:string,notionalUsd?:number|null) {
 if(ctx.connectorId && !(await query("SELECT 1 FROM mcp_tokens WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND expires_at>NOW() AND scopes ? 'execute'",[ctx.connectorId,ctx.userId,ctx.agentId])).rows.length)throw Error("Connector execution permission revoked before signing");
 if(ctx.runId && !(await query("SELECT 1 FROM agent_runs WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND status='running' AND heartbeat_at>NOW()-INTERVAL '15 minutes'",[ctx.runId,ctx.userId,ctx.agentId])).rows.length)throw Error("Worker run lease expired");
 const r=await query("SELECT payload,approval,kind,expires_at FROM execution_orders WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND status='submitting'",[id,ctx.userId,ctx.agentId]);
 const order=r.rows[0];if(!order||new Date(order.expires_at).getTime()<=Date.now())throw Error("Execution authorization expired");
 if(order.payload.exitRuleId){
  const rule=(await query("SELECT * FROM spot_exit_rules WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND order_id=$4",[order.payload.exitRuleId,ctx.userId,ctx.agentId,id])).rows[0];checkExitRule(rule,order.payload);return;
 }
 if(order.payload.exitPlan&&!(await query("SELECT 1 FROM worker_health WHERE name='execution-monitor' AND heartbeat_at>NOW()-INTERVAL '90 seconds'")).rows.length)throw Error("Protective exit monitor unavailable; new spot entries paused");
 const risk=await getRisk(ctx.userId,ctx.agentId);
 if(risk.paused&&!['close','cancel','protection'].includes(order.kind))throw Error("Trading was paused before signing");
 if(order.approval!=="owner") {
  if(!risk.autoExecute)throw Error("Automatic execution disabled before signing");
  const active=await getActiveStrategy(ctx.userId,ctx.agentId);
  if(!["close","cancel","protection"].includes(order.kind)&&(active?.version!==order.payload.strategyVersion||!judge(null,{ok:true,oos:active?.metrics?.challenger}).win||!Number.isFinite(Date.parse(active?.metrics?.evaluatedAt))||Date.now()-Date.parse(active?.metrics?.evaluatedAt)>7*86400000))throw Error("Strategy evidence changed or expired before signing");
  checkMandate(await getMandate(ctx.userId,ctx.agentId),{...order.payload,...(notionalUsd===undefined?{}:{notionalUsd})});
  if(notionalUsd!==undefined && (!Number.isFinite(notionalUsd)||Number(notionalUsd)>Number(order.payload.reservedNotionalUsd??order.payload.notionalUsd)))throw Error("Current value exceeds reserved daily allowance; obtain a fresh proposal");
 }
}
export async function executeOnce(ctx:Scope,id:string,kind:string,dispatch:(payload:any,id:string)=>Promise<any>) {
 if(!/^[0-9a-f-]{36}$/i.test(id))throw new Error("Invalid execution ID; obtain a new proposal");
 await getRisk(ctx.userId,ctx.agentId); // Ensure legacy risk storage before acquiring the transactional connection.
 const row=await transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtext($1))",[`${ctx.userId}:${ctx.agentId}`]);
   const r=await tx.query("SELECT * FROM execution_orders WHERE id=$1 AND user_id=$2 AND agent_id=$3 FOR UPDATE",[id,ctx.userId,ctx.agentId]);
   const order=r.rows[0];
   if(!order || order.kind!==kind)throw new Error("Order not found for this agent");
   if(!['proposed','approved'].includes(order.status))return {...order,duplicate:true};
   if(new Date(order.expires_at).getTime()<=Date.now())throw new Error("Proposal expired; obtain fresh terms");
   if(order.payload.exitPlan&&!(await tx.query("SELECT 1 FROM worker_health WHERE name='execution-monitor' AND heartbeat_at>NOW()-INTERVAL '90 seconds'")).rows.length)throw Error("Protective exit monitor unavailable; new spot entries paused");
   let protective=false;
   if(order.payload.exitRuleId){const rule=(await tx.query("SELECT * FROM spot_exit_rules WHERE id=$1 AND user_id=$2 AND agent_id=$3 AND order_id=$4 FOR UPDATE",[order.payload.exitRuleId,ctx.userId,ctx.agentId,id])).rows[0];checkExitRule(rule,order.payload);protective=true;}
   const risk={...RISK_DEFAULTS,...(await tx.query("SELECT config FROM agent_risk WHERE user_id=$1 AND agent_id=$2",[ctx.userId,ctx.agentId])).rows[0]?.config};
   if(!protective && risk.paused && !['close','cancel','protection'].includes(kind))throw new Error("New trading is paused");
   if(!protective && order.approval!=='owner') {
     if(!risk.autoExecute)throw new Error("Owner approval required in Trading control");
     const config=(await tx.query("SELECT config FROM trading_mandates WHERE user_id=$1 AND agent_id=$2",[ctx.userId,ctx.agentId])).rows[0]?.config;
     const mandate=config?mandateSchema.parse(config):null;checkMandate(mandate,order.payload);
     const strategy=(await tx.query("SELECT version,metrics FROM agent_strategy WHERE user_id=$1 AND agent_id=$2 AND status='active' ORDER BY version DESC LIMIT 1",[ctx.userId,ctx.agentId])).rows[0];
     if(!["close","cancel","protection"].includes(kind) && (strategy?.version!==mandate!.strategyVersion || !Number.isFinite(Date.parse(strategy?.metrics?.evaluatedAt)) || Date.now()-Date.parse(strategy.metrics.evaluatedAt)>7*86400000 || !judge(null,{ok:true,oos:strategy?.metrics?.challenger}).win))throw new Error("Active strategy lacks qualifying held-out evidence");
     const used=await tx.query("SELECT COALESCE(SUM(COALESCE((payload->>'reservedNotionalUsd')::numeric,(payload->>'notionalUsd')::numeric)),0) AS total FROM execution_orders WHERE user_id=$1 AND agent_id=$2 AND status NOT IN ('proposed','approved','rejected','blocked') AND created_at >= date_trunc('day',NOW() AT TIME ZONE 'UTC')",[ctx.userId,ctx.agentId]);
     if(Number(used.rows[0].total)+(["trade","swap"].includes(kind)?mandate!.maxOrderUsd:0)>mandate!.maxDailyTurnoverUsd)throw new Error("Daily turnover allowance exceeded");
     if(["trade","swap"].includes(kind)){order.payload.reservedNotionalUsd=mandate!.maxOrderUsd;await tx.query("UPDATE execution_orders SET payload=$2 WHERE id=$1",[id,JSON.stringify(order.payload)]);}
   }
   const n=await tx.query("SELECT count(*)::int AS n FROM execution_orders WHERE user_id=$1 AND agent_id=$2 AND status NOT IN ('proposed','approved','rejected','blocked') AND created_at >= date_trunc('day',NOW() AT TIME ZONE 'UTC')",[ctx.userId,ctx.agentId]);
   if(!protective && risk.maxTradesPerDay!==null && n.rows[0].n>=risk.maxTradesPerDay && !['close','cancel','protection'].includes(kind))throw new Error("Daily order limit reached");
   await tx.query("UPDATE execution_orders SET status='submitting',approval=COALESCE(approval,'mandate'),updated_at=NOW() WHERE id=$1",[id]);
   return order;
 });
 if(row.duplicate)return {duplicate:true,status:row.status,orderId:id,...(row.result??{}),error:row.error};
 try {
   const result=await dispatch({...row.payload,validUntilMs:new Date(row.expires_at).getTime()},id);
   const status=result.placed===false?'blocked':result.status??'submitted';
   await transaction(async tx=>{await tx.query("UPDATE execution_orders SET status=$2,result=$3,updated_at=NOW() WHERE id=$1 AND status='submitting'",[id,status,JSON.stringify(result)]);await attachFilledExit(tx,row,{...result,status});});
   return {...result,status,orderId:id};
 }catch(error){
   // Unknown is intentionally not retryable: reconcile the recorded tx/order identity first.
   const evidence=await query("SELECT 1 FROM execution_events WHERE order_id=$1 AND kind IN ('transaction','venue_submission') LIMIT 1",[id]);
   await query("UPDATE execution_orders SET status=$3,error=$2,updated_at=NOW() WHERE id=$1 AND status='submitting'",[id,error instanceof Error?error.message:'Execution interrupted',evidence.rows.length?'unknown':'blocked']);
   throw error;
 }
}
