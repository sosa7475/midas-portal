import {createPublicClient,http} from "viem";
import {query,transaction} from "./db";
import {CHAINS} from "./dex";
import type {Scope} from "./execution-orders";
/** Only release expired EVM reservations with provable absence of a recorded swap. Never assume a missing receipt means no send. */
export async function recoverApprovalOnly(ctx:Scope,id:string){
 const row=(await query("SELECT * FROM execution_orders WHERE id=$1 AND user_id=$2 AND agent_id=$3",[id,ctx.userId,ctx.agentId])).rows[0];
 if(!row||row.kind!=="swap"||!["unknown","submitting"].includes(row.status)||new Date(row.expires_at).getTime()>Date.now())throw Error("Only expired uncertain EVM reservations can use approval recovery");
 if(row.transactions.some((t:any)=>t.stage!=="approval"))throw Error("Swap hash exists; reconcile its receipt instead of releasing the account");
 const c=CHAINS[row.payload.chain],client=createPublicClient({transport:http(c.rpc)});
 if(await client.getChainId()!==c.id)throw Error("Chain mismatch");
 for(const t of row.transactions){
  const receipt=await client.getTransactionReceipt({hash:t.hash});const block=await client.getBlock({blockNumber:receipt.blockNumber});
  if(await client.getBlockNumber()<receipt.blockNumber+1n||block.hash!==receipt.blockHash||receipt.from.toLowerCase()!==row.payload.account.toLowerCase()||receipt.to?.toLowerCase()!==row.payload.tokenIn.toLowerCase())throw Error("Approval receipt is not confirmed for this order");
 }
 await transaction(async tx=>{
  const current=(await tx.query("SELECT * FROM execution_orders WHERE id=$1 AND user_id=$2 AND agent_id=$3 FOR UPDATE",[id,ctx.userId,ctx.agentId])).rows[0];
  if(!["unknown","submitting"].includes(current?.status)||JSON.stringify(current.transactions)!==JSON.stringify(row.transactions))throw Error("Order changed during recovery; refresh its status");
  await tx.query("UPDATE execution_orders SET status='abandoned',error='Expired reservation released after approval-only verification; no swap submitted',updated_at=NOW() WHERE id=$1",[id]);
  await tx.query("INSERT INTO execution_events(order_id,kind,data) VALUES($1,'owner_recovery',$2)",[id,JSON.stringify({userId:ctx.userId,approvalHashes:row.transactions.map((t:any)=>t.hash)})]);
 });
 return {resolved:true,status:"abandoned",note:"No swap was submitted. Any confirmed approval remains on chain. A new trade requires a fresh proposal."};
}
