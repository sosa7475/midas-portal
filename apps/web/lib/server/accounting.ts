import {query} from "./db";
import {CHAINS} from "./dex";
import {formatUnits} from "viem";
import type {Scope} from "./execution-orders";
/** FIFO over verified Midas fills only. External transfers and opening holdings remain unknown. */
export function fifoAccounting(rows:any[]){
 type Lot={quantity:bigint;cost:bigint};
 const lots=new Map<string,Lot[]>(),realized=new Map<string,bigint>();const unresolved:string[]=[];
 let totalNativeFees=0n,feesComplete=true;
 for(const r of rows){
  const c=CHAINS[r.chain];if(!c){unresolved.push(r.order_id);continue;}
  const input=String(r.token_in).toLowerCase(),output=String(r.token_out).toLowerCase();
  const isQuote=(t:string)=>[c.wnative.toLowerCase(),c.usdc?.toLowerCase()].includes(t);
  const i=BigInt(r.input_raw),o=BigInt(r.output_raw);if(i<=0n||o<=0n){unresolved.push(r.order_id);continue;}
  if(r.fee_wei==null)feesComplete=false;else totalNativeFees+=BigInt(r.fee_wei);
  if(isQuote(input)&&!isQuote(output)){
   const key=`${r.chain}:${r.account}:${output}:${input}`;const queue=lots.get(key)??[];
   queue.push({quantity:o,cost:i});lots.set(key,queue);
  }else if(!isQuote(input)&&isQuote(output)){
   const key=`${r.chain}:${r.account}:${input}:${output}`,queue=lots.get(key)??[];
   let left=i,cost=0n;
   while(left>0n&&queue.length){const lot=queue[0],take=left<lot.quantity?left:lot.quantity;
    const used=lot.cost*take/lot.quantity;cost+=used;lot.cost-=used;lot.quantity-=take;left-=take;if(lot.quantity===0n)queue.shift();}
   lots.set(key,queue);
   if(left>0n){unresolved.push(r.order_id);continue;}
   const currency=`${r.chain}:${output}:${r.decimals_out}`;realized.set(currency,(realized.get(currency)??0n)+o-cost);
  }else unresolved.push(r.order_id);
 }
 return {realizedBeforeNetworkFees:[...realized].map(([key,value])=>{const [chain,token,decimals]=key.split(":");return {chain,token,amount:formatUnits(value,Number(decimals))};}),networkFeesEth:feesComplete?formatUnits(totalNativeFees,18):null,knownNetworkFeesEth:formatUnits(totalNativeFees,18),unmatchedOrderIds:unresolved,openLots:[...lots].filter(([,q])=>q.length).map(([key,q])=>({key,quantityRaw:q.reduce((n,l)=>n+l.quantity,0n).toString(),costRaw:q.reduce((n,l)=>n+l.cost,0n).toString()})),complete:false,scope:"Verified Midas fills since execution-ledger deployment. FIFO by account, chain and quote token. External transfers, initial holdings, historical trades and cross-quote cost basis are excluded. Native fees are separate; not combined USD P&L."};
}
export async function getAccounting(ctx:Scope){const r=await query("SELECT * FROM trade_accounting WHERE user_id=$1 AND agent_id=$2 ORDER BY block_number,observed_at,order_id",[ctx.userId,ctx.agentId]);return fifoAccounting(r.rows);}
