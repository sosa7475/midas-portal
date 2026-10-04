import {CHAINS} from "./dex";
import {parseUnits} from "viem";
export function needsEntryExit(p:any){
 const c=CHAINS[p.chain];if(!c||p.t!=="swap"||p.exitRuleId)return false;
 const input=p.tokenIn.toLowerCase(),output=p.tokenOut.toLowerCase();
 return [c.wnative.toLowerCase(),c.usdc?.toLowerCase()].includes(input)&&output!==c.usdc?.toLowerCase();
}
/** Persist protection from the actual received amount, not the quote. Caller uses its order-result transaction. */
export async function attachFilledExit(tx:any,order:any,result:any){
 const p=order.payload,plan=p.exitPlan;
 if(order.kind!=="swap"||result.status!=="filled"||!plan)return;
 if(!result.amountOutRaw||BigInt(result.amountOutRaw)<=0n)throw Error("Cannot attach exit without verified output");
 const cost=parseUnits(p.amountInHuman,p.decimalsIn),stop=cost*(10000n-BigInt(Math.round(plan.stopLossPct*100)))/10000n;
 const target=plan.takeProfitPct?cost*(10000n+BigInt(Math.round(plan.takeProfitPct*100)))/10000n:null;
 if(stop<=0n)throw Error("Exit threshold rounds to zero");
 await tx.query(`INSERT INTO spot_exit_rules(user_id,agent_id,chain,account,token_in,token_out,amount_raw,decimals_in,decimals_out,stop_out_raw,target_out_raw,slippage_pct,gas_reserve_eth,max_gas_eth,expires_at,entry_order_id,exit_at)
 VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW()+($15+300)*INTERVAL '1 second',$16,NOW()+$15*INTERVAL '1 second') ON CONFLICT(entry_order_id) DO NOTHING`,[order.user_id,order.agent_id,p.chain,p.account.toLowerCase(),p.tokenOut.toLowerCase(),p.tokenIn.toLowerCase(),result.amountOutRaw,p.decimalsOut,p.decimalsIn,stop.toString(),target?.toString()??null,p.slippagePct,p.gasReserveEth,p.maxGasEth,plan.maxHoldingSeconds,order.id]);
}
