import {query} from "./db";
import type {Scope} from "./execution-orders";
export async function alert(ctx:Scope,key:string,message:string,details:unknown={},severity="error"){
 await query(`INSERT INTO operational_alerts(user_id,agent_id,dedupe_key,severity,message,details) VALUES($1,$2,$3,$4,$5,$6)
 ON CONFLICT(user_id,agent_id,dedupe_key) DO UPDATE SET last_seen_at=NOW(),message=$5,details=$6,revision=CASE WHEN operational_alerts.message=$5 THEN operational_alerts.revision ELSE operational_alerts.revision+1 END,acknowledged_at=CASE WHEN operational_alerts.message=$5 THEN operational_alerts.acknowledged_at ELSE NULL END`,[ctx.userId,ctx.agentId,key,severity,message,JSON.stringify(details)]);
}
export async function heartbeat(name:string,details:unknown={}){await query("INSERT INTO worker_health(name,details) VALUES($1,$2) ON CONFLICT(name) DO UPDATE SET heartbeat_at=NOW(),details=$2",[name,JSON.stringify(details)]);}
export async function operationStatus(ctx:Scope){
 const [alerts,health]=await Promise.all([query("SELECT id,severity,message,details,created_at,last_seen_at FROM operational_alerts WHERE user_id=$1 AND agent_id=$2 AND acknowledged_at IS NULL ORDER BY last_seen_at DESC LIMIT 50",[ctx.userId,ctx.agentId]),query("SELECT name,heartbeat_at,heartbeat_at>NOW()-INTERVAL '90 seconds' AS healthy FROM worker_health")]);
 return {alerts:alerts.rows,workers:health.rows,healthy:["execution-monitor","reconciliation-monitor","research-worker"].every(n=>health.rows.some(r=>r.name===n&&r.healthy))};
}
