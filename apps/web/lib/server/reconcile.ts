import {attachFilledExit} from "./attached-exit";
import {hlOrderState,protectiveIds} from "./hl-reconciliation";
import {getOrder,getAccount} from "./hyperliquid";
import {receiptNetworkFee} from "./network-fees";
import {alert} from "./operations";
import {receivedToken} from "./receipt-output";
import {createPublicClient,http,formatUnits,type Address} from "viem";
import {query,transaction} from "./db";
import {CHAINS} from "./dex";
import {HL_BASES,type HlNetwork} from "./hyperliquid";

/** Read-only venue checks. Never re-sign or resubmit an ambiguous operation. */
export async function reconcileOrders() {
 const rows=(await query("SELECT * FROM execution_orders WHERE (status IN ('submitting','submitted','unknown','partially_filled') OR (kind='trade' AND status='filled' AND payload->>'stopLoss' IS NOT NULL) OR (kind='swap' AND status='filled' AND (NOT EXISTS(SELECT 1 FROM trade_accounting a WHERE a.order_id=execution_orders.id) OR (payload->'exitPlan' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM spot_exit_rules e WHERE e.entry_order_id=execution_orders.id))))) AND updated_at<NOW()-INTERVAL '3 minutes' ORDER BY updated_at LIMIT 100")).rows;
 const outcomes=[];
 for(const o of rows) {
  try {
   if(o.kind==="swap") {
    const c=CHAINS[o.payload.chain];if(!c)throw Error("Unknown chain");
    const client=createPublicClient({transport:http(c.rpc)});
    if(await client.getChainId()!==c.id)throw Error("Chain mismatch");
    const swap=o.transactions.findLast((t:any)=>t.stage==="swap");
    if(!swap){await alert({userId:o.user_id,agentId:o.agent_id},`reconcile:${o.id}`,"No swap hash recorded; owner approval-only recovery may be available",{orderId:o.id});await query("UPDATE execution_orders SET status='unknown',error='No swap hash recorded; review before releasing account',updated_at=NOW() WHERE id=$1",[o.id]);continue;}
    const receipt=await client.getTransactionReceipt({hash:swap.hash});
    const [head,block]=await Promise.all([client.getBlockNumber(),client.getBlock({blockNumber:receipt.blockNumber})]);
    if(head<receipt.blockNumber+1n||block.hash!==receipt.blockHash)continue;
    if(receipt.from.toLowerCase()!==o.payload.account.toLowerCase()||receipt.to?.toLowerCase()!==c.router.toLowerCase())throw Error("Transaction does not match reserved account/router");
    const received=receivedToken(receipt.logs,o.payload.tokenOut,o.payload.account);
    const status=receipt.status==="success"?(received>=BigInt(o.payload.minimumOutRaw)?"filled":"review_required"):"reverted";
    let totalFee=await receiptNetworkFee(client,o.payload.chain,receipt);
    for(const leg of o.transactions.filter((t:any)=>t.stage==="approval")){
     const ar=await client.getTransactionReceipt({hash:leg.hash});const fee=await receiptNetworkFee(client,o.payload.chain,ar);totalFee=totalFee===null||fee===null?null:totalFee+fee;
    }
    let accountingValues:any[]|null=null;
    if(status==="filled"){
     const tx=await client.getTransaction({hash:swap.hash});
     const input=o.payload.nativeIn?tx.value:-receivedToken(receipt.logs,o.payload.tokenIn,o.payload.account);
     if(input<=0n)throw Error("Input transfer evidence missing");
     accountingValues=[o.id,o.user_id,o.agent_id,o.payload.chain,o.payload.account,o.payload.tokenIn,o.payload.tokenOut,input.toString(),received.toString(),o.payload.decimalsIn,o.payload.decimalsOut,totalFee?.toString()??null,receipt.blockNumber.toString(),receipt.blockHash];
    }
    const result={...o.result,status,amountOut:receipt.status==="success"?formatUnits(received,o.payload.decimalsOut):null,amountOutRaw:receipt.status==="success"?received.toString():null,swapTx:swap.hash,blockNumber:String(receipt.blockNumber),blockHash:receipt.blockHash,receiptVerified:true,executionFeeWei:String(receipt.gasUsed*receipt.effectiveGasPrice),totalFeeWei:totalFee?.toString()??null};
    await transaction(async tx=>{
     const current=(await tx.query("SELECT status FROM execution_orders WHERE id=$1 FOR UPDATE",[o.id])).rows[0];
     if(!current||!['submitting','submitted','unknown','filled'].includes(current.status))return;
     if(accountingValues)await tx.query(`INSERT INTO trade_accounting(order_id,user_id,agent_id,chain,account,token_in,token_out,input_raw,output_raw,decimals_in,decimals_out,fee_wei,block_number,block_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) ON CONFLICT(order_id) DO UPDATE SET fee_wei=EXCLUDED.fee_wei,block_hash=EXCLUDED.block_hash`,accountingValues);
     await attachFilledExit(tx,o,result);
     await tx.query("UPDATE execution_orders SET status=$2,result=$3,error=NULL,updated_at=NOW() WHERE id=$1",[o.id,status,JSON.stringify(result)]);
    });
    if(status==="review_required")await alert({userId:o.user_id,agentId:o.agent_id},`reconcile:${o.id}`,"Swap receipt output is below the reviewed minimum",{orderId:o.id});
    outcomes.push({id:o.id,status});
   } else if(["trade","close","protection","cancel"].includes(o.kind)) {
    const base=HL_BASES[o.payload.network as HlNetwork];if(!base)throw Error("Unknown venue network");
    const network=o.payload.network as HlNetwork;
    const j=await getOrder(o.payload.account,o.kind==="cancel"?o.payload.orderId:`0x${o.id.replace(/-/g,"")}`,network);
    const state=hlOrderState(j);const status=state.status;
    const children=await Promise.all(protectiveIds(o.id,o.payload,o.kind).map(async id=>({id,...hlOrderState(await getOrder(o.payload.account,id,network))})));
    if(o.kind==="trade"&&o.payload.stopLoss&&["filled","partially_filled"].includes(status)){
     const acct=await getAccount(o.payload.account,network);
     const position=acct.positions.find((x:any)=>x.coin===o.payload.symbol);
     if(position&&Math.abs(position.szi)>0&&!children.some(c=>c.id===protectiveIds(o.id,o.payload,o.kind)[0]&&["submitted","partially_filled"].includes(c.status))){
      await alert({userId:o.user_id,agentId:o.agent_id},`protection:${o.id}`,"Open perpetual position has no verified active stop; new entries paused",{orderId:o.id,children});
      await query("UPDATE agent_risk SET config=jsonb_set(config,'{paused}','true'),updated_at=NOW() WHERE user_id=$1 AND agent_id=$2",[o.user_id,o.agent_id]);
     }
    }
    await query("UPDATE execution_orders SET status=$2,result=$3,updated_at=NOW() WHERE id=$1",[o.id,status,JSON.stringify({status,venue:j,filledSize:state.filledSize,children})]);outcomes.push({id:o.id,status});
   }
  } catch(e) {await query("UPDATE execution_orders SET updated_at=NOW() WHERE id=$1",[o.id]);await alert({userId:o.user_id,agentId:o.agent_id},`reconcile:${o.id}`,"Order reconciliation needs attention",{orderId:o.id,error:e instanceof Error?e.message:"Reconciliation failed"});outcomes.push({id:o.id,status:"unresolved",error:e instanceof Error?e.message:"Reconciliation failed"});}
 }
 return outcomes;
}
