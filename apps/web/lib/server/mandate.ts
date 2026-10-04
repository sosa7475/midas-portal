import {needsEntryExit} from "./attached-exit";
import { z } from "zod";
import { query } from "./db";

export const mandateSchema = z.object({
  enabled:z.boolean(), expiresAt:z.string().datetime(),
  venues:z.array(z.enum(["base","robinhood","hyperliquid"])).min(1),
  assets:z.array(z.string().min(1).max(50)).min(1).max(40),
  maxOrderUsd:z.number().finite().positive(), maxDailyTurnoverUsd:z.number().finite().positive(),
  maxLeverage:z.number().finite().min(1).max(10).default(1),
  maxSlippageBps:z.number().int().min(0).max(300),
  gasReserveEth:z.string().regex(/^\d+(\.\d{1,18})?$/),
  maxGasEth:z.string().regex(/^\d+(\.\d{1,18})?$/).refine(v=>Number(v)>0),
  spotExit:z.object({stopLossPct:z.number().finite().min(0.1).max(50),takeProfitPct:z.number().finite().min(0.1).max(1000).optional(),maxHoldingSeconds:z.number().int().min(60).max(30*86400)}).strict().optional(),
  strategyVersion:z.number().int().positive(),
}).strict();
export type Mandate = z.infer<typeof mandateSchema>;
export async function getMandate(userId:string,agentId:string):Promise<Mandate|null> {
  const r=await query("SELECT config FROM trading_mandates WHERE user_id=$1 AND agent_id=$2",[userId,agentId]);
  return r.rows.length ? mandateSchema.parse(r.rows[0].config) : null;
}
export function checkMandate(m:Mandate|null,p:any,now=Date.now()) {
  if(!m?.enabled || Date.parse(m.expiresAt)<=now) throw new Error("Owner trading mandate missing, disabled or expired");
  if(!m.venues.includes(p.chain ?? "hyperliquid")) throw new Error("Venue outside mandate");
  const assets=(p.t==='swap'?[p.tokenIn,p.tokenOut]:[p.symbol]).map((x:string)=>x.toLowerCase());
  if(assets.some((x:string)=>!m.assets.map(a=>a.toLowerCase()).includes(x))) throw new Error("Asset outside mandate");
  if(["close","cancel","protection"].includes(p.t))return;
  if(!Number.isFinite(p.notionalUsd) || p.notionalUsd<=0 || p.notionalUsd>m.maxOrderUsd) throw new Error("Order value unavailable or outside mandate");
  if((p.slippagePct??0)*100>m.maxSlippageBps) throw new Error("Slippage outside mandate");
  if(needsEntryExit(p)&&(!m.spotExit||!p.exitPlan||JSON.stringify(m.spotExit)!==JSON.stringify(p.exitPlan)))throw Error("Autonomous spot entry needs owner-authorized stop/target terms");
  if(p.strategyVersion!==m.strategyVersion) throw new Error("Strategy version outside mandate");
}
