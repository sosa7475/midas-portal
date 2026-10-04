import {CHAINS,quoteSwap} from "./dex";
import {markPrice} from "./hyperliquid";
import type {Address} from "viem";
/** Liquidation-quote estimate for caps, never reported as realized value. */
export async function spotValueUsd(chain:string,token:Address,amount:string,decimals:number):Promise<number|null>{
 const c=CHAINS[chain];if(!c)return null;
 if(token.toLowerCase()===c.usdc?.toLowerCase())return Number(amount);
 const eth=await markPrice("ETH","mainnet");if(!eth||eth<=0)return null;
 if(token.toLowerCase()===c.wnative.toLowerCase())return Number(amount)*eth;
 try{const q=await quoteSwap(chain,token,c.wnative,amount,decimals,18);const value=Number(q.amountOut)*eth;return Number.isFinite(value)&&value>0?value:null;}catch{return null;}
}
