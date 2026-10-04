import {query,transaction} from "./db";
import {CHAINS,getDecimals,tokenBalance,quoteSwap} from "./dex";
import {formatUnits,parseUnits,type Address} from "viem";
import {exitRuleSchema,exitTriggered} from "./spot-exit-policy";
import {loadKeysetPublic} from "./turnkey-sql";
import {alert} from "./operations";
import type {Scope} from "./execution-orders";
export async function listExitRules(ctx:Scope){return (await query("SELECT * FROM spot_exit_rules WHERE user_id=$1 AND agent_id=$2 ORDER BY created_at DESC LIMIT 100",[ctx.userId,ctx.agentId])).rows;}
export async function createExitRule(ctx:Scope,input:unknown){
 const p=exitRuleSchema.parse(input),c=CHAINS[p.chain];
 if(![c.wnative.toLowerCase(),c.usdc?.toLowerCase()].includes(p.tokenOut.toLowerCase()))throw Error("Exit destination must be this chain's WETH or supported USDC");
 if(p.tokenIn.toLowerCase()===p.tokenOut.toLowerCase())throw Error("Exit tokens must differ");
 if(Date.parse(p.expiresAt)<=Date.now()||Date.parse(p.expiresAt)>Date.now()+30*86400000)throw Error("Exit expiry must be within 30 days");
 if(parseUnits(p.maxGasEth,18)<=0n)throw Error("Positive gas budget required");
 const k=await loadKeysetPublic(ctx.userId,ctx.agentId);if(!k)throw Error("Agent wallet required");
 const [din,dout]=await Promise.all([getDecimals(p.chain,p.tokenIn as Address),getDecimals(p.chain,p.tokenOut as Address)]);
 for(const [v,d] of [[p.amount,din],[p.stopOutput,dout],[p.targetOutput??"0",dout]] as const)if((v.split('.')[1]?.length??0)>d)throw Error("Amount exceeds token precision");
 const amount=parseUnits(p.amount,din),stop=parseUnits(p.stopOutput,dout),target=p.targetOutput?parseUnits(p.targetOutput,dout):null;
 if(amount<=0n||stop<=0n||target!==null&&target<=stop)throw Error("Invalid exit thresholds");
 if(await tokenBalance(p.chain,p.tokenIn as Address,k.evmAddress as Address)<amount)throw Error("Insufficient token holdings for this exit");
 return (await query(`INSERT INTO spot_exit_rules(user_id,agent_id,chain,account,token_in,token_out,amount_raw,decimals_in,decimals_out,stop_out_raw,target_out_raw,slippage_pct,gas_reserve_eth,max_gas_eth,expires_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[ctx.userId,ctx.agentId,p.chain,k.evmAddress.toLowerCase(),p.tokenIn.toLowerCase(),p.tokenOut.toLowerCase(),amount.toString(),din,dout,stop.toString(),target?.toString()??null,p.slippagePct,p.gasReserveEth,p.maxGasEth,p.expiresAt])).rows[0];
}
export async function monitorExits(){
 const rules=(await query("SELECT * FROM spot_exit_rules WHERE status IN ('armed','executing') ORDER BY updated_at LIMIT 100")).rows;
 const outcomes=[];
 for(const rule of rules){
  const ctx={userId:rule.user_id,agentId:rule.agent_id};
  try{
   if(new Date(rule.expires_at).getTime()<=Date.now()){
    await query("UPDATE spot_exit_rules SET status='expired',updated_at=NOW() WHERE id=$1 AND status IN ('armed','executing')",[rule.id]);
    await alert(ctx,`exit:${rule.id}`,"Spot exit authorization expired; position may remain open");continue;
   }
   let orderId=rule.order_id;
   if(rule.status==="armed"){
    const observedAt=Date.now();
    const amount=formatUnits(BigInt(rule.amount_raw),rule.decimals_in);
    const q=await quoteSwap(rule.chain,rule.token_in,rule.token_out,amount,rule.decimals_in,rule.decimals_out);
    if(!(rule.exit_at&&new Date(rule.exit_at).getTime()<=Date.now())&&!exitTriggered(q.amountOutRaw,BigInt(rule.stop_out_raw),rule.target_out_raw===null?null:BigInt(rule.target_out_raw))){await query("UPDATE spot_exit_rules SET updated_at=NOW(),last_error=NULL WHERE id=$1",[rule.id]);continue;}
    if(Date.now()-observedAt>30000)throw Error("Exit quote is stale");
    orderId=await transaction(async tx=>{
     const locked=(await tx.query("SELECT * FROM spot_exit_rules WHERE id=$1 FOR UPDATE",[rule.id])).rows[0];
     if(locked.status!=="armed"||new Date(locked.expires_at).getTime()<=Date.now())return null;
     const payload={t:"swap",exitRuleId:rule.id,chain:rule.chain,account:rule.account,tokenIn:rule.token_in,tokenOut:rule.token_out,amountInHuman:amount,decimalsIn:rule.decimals_in,decimalsOut:rule.decimals_out,nativeIn:false,slippagePct:Number(rule.slippage_pct),minimumOutRaw:(q.amountOutRaw-q.amountOutRaw*BigInt(Math.round(Number(rule.slippage_pct)*100))/10000n).toString(),gasReserveEth:rule.gas_reserve_eth,maxGasEth:rule.max_gas_eth,notionalUsd:null};
     const o=await tx.query("INSERT INTO execution_orders(user_id,agent_id,request_key,kind,account_key,payload,status,approval,approved_at,expires_at) VALUES($1,$2,$3,'swap',$4,$5,'approved','exit_rule',NOW(),LEAST($6,NOW()+INTERVAL '3 minutes')) RETURNING id",[ctx.userId,ctx.agentId,`exit:${rule.id}`,`evm:${CHAINS[rule.chain].id}:${rule.account}`,JSON.stringify(payload),rule.expires_at]);
     await tx.query("UPDATE spot_exit_rules SET status='executing',order_id=$2,updated_at=NOW() WHERE id=$1",[rule.id,o.rows[0].id]);return o.rows[0].id;
    });
   }
   if(!orderId)continue;
   const {callTool}=await import("./mcp-tools");
   const result=await callTool("execute_swap",{intent:orderId},ctx);
   const state=result.status==="filled"?"closed":["submitting","submitted","unknown"].includes(result.status)?"executing":"review_required";
   await query("UPDATE spot_exit_rules SET status=$2,updated_at=NOW(),last_error=$3 WHERE id=$1 AND status='executing'",[rule.id,state,result.error??null]);
   if(state==="review_required")await alert(ctx,`exit:${rule.id}`,"Spot exit needs attention",{orderId,status:result.status});
   outcomes.push({id:rule.id,status:state});
  }catch(e){const error=e instanceof Error?e.message:"Exit monitor failed";await query("UPDATE spot_exit_rules SET last_error=$2,updated_at=NOW() WHERE id=$1",[rule.id,error]);await alert(ctx,`exit:${rule.id}`,error);outcomes.push({id:rule.id,error});}
 }
 return outcomes;
}
