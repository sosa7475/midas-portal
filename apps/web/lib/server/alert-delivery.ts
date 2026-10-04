import {createHmac} from "node:crypto";
import {query,transaction} from "./db";
/** Optional operator-configured webhook. No destination means alerts remain in the app only. */
export async function deliverAlerts(){
 const destination=process.env.MIDAS_ALERT_WEBHOOK_URL,secret=process.env.MIDAS_ALERT_WEBHOOK_SECRET;
 if(!destination||!secret)return {configured:false};
 if(new URL(destination).protocol!=="https:"||secret.length<32)throw Error("Alert webhook requires HTTPS and a signing secret of at least 32 characters");
 const rows=await transaction(async tx=>{
  const r=await tx.query("SELECT * FROM operational_alerts WHERE delivered_revision<revision AND delivery_after<=NOW() AND (delivery_lease_until IS NULL OR delivery_lease_until<NOW()) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 10");
  for(const row of r.rows)await tx.query("UPDATE operational_alerts SET delivery_lease_until=NOW()+INTERVAL '2 minutes' WHERE id=$1",[row.id]);return r.rows;
 });
 for(const row of rows){
  const timestamp=String(Date.now()),idempotencyKey=`${row.id}:${row.revision}`;
  const body=JSON.stringify({id:row.id,revision:row.revision,agentId:row.agent_id,severity:row.severity,message:row.message,createdAt:row.created_at});
  try{
   const response=await fetch(destination,{method:"POST",redirect:"error",headers:{"content-type":"application/json","idempotency-key":idempotencyKey,"x-midas-timestamp":timestamp,"x-midas-signature":createHmac("sha256",secret).update(timestamp+"."+body).digest("hex")},body,signal:AbortSignal.timeout(5000)});
   if(!response.ok)throw Error("Webhook delivery failed");
   await query("UPDATE operational_alerts SET delivered_revision=$2,delivery_attempts=0,delivery_lease_until=NULL WHERE id=$1",[row.id,row.revision]);
  }catch{
   await query("UPDATE operational_alerts SET delivery_attempts=delivery_attempts+1,delivery_lease_until=NULL,delivery_after=NOW()+LEAST(3600,POWER(2,LEAST(delivery_attempts+1,10))*15)*INTERVAL '1 second' WHERE id=$1",[row.id]);
  }
 }
 return {configured:true,processed:rows.length};
}
