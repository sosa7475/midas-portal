import {createHash} from "node:crypto";

// Pure spot simulation. No exchange client, signer, wallet credential or execution import.
export interface PaperConfig {
  strategyId: string;
  strategyDigest: string;
  initialCashUsd: number;
  maxPositionUsd: number;
  maxDailyRealizedLossUsd: number;
  slippageBps: number;
  maxQuoteAgeMs: number;
  maxHoldingMs: number;
  researchApproved: boolean;
}
export interface PaperQuote {
  side: "buy" | "sell";
  observedAt: number;
  blockNumber: string;
  blockTime: number;
  amountIn: number; // buy: USD; sell: ETH
  amountOut: number; // buy: ETH; sell: USD; pool fees already included
  gasUsd: number; // an explicit all-in gas assumption, including approvals if needed
  costsComplete: boolean;
}
export interface PaperObservation {
  id: string;
  observedAt: number;
  signalKnownAt: number;
  signal: "buy" | "sell" | "hold";
  quote?: PaperQuote;
  evidenceDigest?: string;
}
export interface PaperPosition { units: number; costUsd: number; openedAt: number }
export interface PaperState {
  mode: "paper";
  configDigest: string;
  cashUsd: number;
  position: PaperPosition | null;
  realizedPnlUsd: number;
  dailyRealizedPnlUsd: number;
  day: string;
  lastObservedAt: number;
  processed: Record<string,string>;
  trades: number;
}
export interface PaperDecision {
  action: "hold" | "buy" | "sell" | "need_sell_quote";
  reason: string;
  state: PaperState;
  fill?: {side:"buy"|"sell"; at:number; units:number; cashChangeUsd:number; gasUsd:number; realizedPnlUsd?:number};
}
export const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const positive = (n:number) => Number.isFinite(n) && n>0;

export function createPaperState(config:PaperConfig):PaperState {
  if (!config.strategyId || !config.strategyDigest || ![config.initialCashUsd,config.maxPositionUsd,config.maxDailyRealizedLossUsd,config.maxQuoteAgeMs,config.maxHoldingMs].every(positive) || !Number.isFinite(config.slippageBps) || config.slippageBps<0 || config.slippageBps>=10000) throw new Error("Invalid paper configuration");
  return {mode:"paper",configDigest:digest(config),cashUsd:config.initialCashUsd,position:null,realizedPnlUsd:0,dailyRealizedPnlUsd:0,day:"",lastObservedAt:0,processed:{},trades:0};
}

export function stepPaper(config:PaperConfig,prior:PaperState,observation:PaperObservation):PaperDecision {
  if(prior.mode!=="paper" || prior.configDigest!==digest(config)) throw new Error("Paper rules changed; start a separate trial");
  const fingerprint=digest(observation);
  if(prior.processed[observation.id]) {
    if(prior.processed[observation.id]!==fingerprint) throw new Error("Observation ID reused with different data");
    return {action:"hold",reason:"Duplicate observation; no second fill",state:prior};
  }
  if(!observation.id || !positive(observation.observedAt) || observation.observedAt<=prior.lastObservedAt || !positive(observation.signalKnownAt) || observation.signalKnownAt>observation.observedAt) throw new Error("Paper observations must advance time and use known signals");
  const state:PaperState=structuredClone(prior);
  const day=new Date(observation.observedAt).toISOString().slice(0,10);
  if(state.day!==day){state.day=day;state.dailyRealizedPnlUsd=0;}
  state.lastObservedAt=observation.observedAt;
  state.processed[observation.id]=fingerprint;
  const hold=(reason:string):PaperDecision=>({action:"hold",reason,state});
  const expired=state.position!=null && observation.observedAt-state.position.openedAt>=config.maxHoldingMs;
  const wantsSell=state.position!=null && (observation.signal==="sell" || expired);
  const wantsBuy=state.position==null && observation.signal==="buy";
  if(!wantsSell && !wantsBuy)return hold("No actionable paper signal");
  if(wantsBuy && !config.researchApproved)return hold("No strategy has passed research gates; paper entries disabled");
  if(wantsBuy && state.dailyRealizedPnlUsd<=-config.maxDailyRealizedLossUsd)return hold("Daily paper loss limit reached");
  const q=observation.quote;
  if(wantsSell && (!q || q.side!=="sell"))return {action:"need_sell_quote",reason:expired?"Holding limit reached; obtain a fresh sell quote, do not backdate an exit":"Sell signal needs a fresh sell quote",state};
  if(!q || q.side!==(wantsSell?"sell":"buy"))return hold("Missing quote for the requested direction");
  if(!q.costsComplete)return hold("Gas/approval cost assumption is incomplete; no paper fill");
  if(!positive(q.blockTime) || q.blockTime>observation.observedAt || observation.observedAt-q.blockTime>config.maxQuoteAgeMs || !positive(q.observedAt) || q.observedAt>observation.observedAt || q.observedAt<observation.signalKnownAt || observation.observedAt-q.observedAt>config.maxQuoteAgeMs)return hold("Quote is stale, future-dated or predates the signal");
  if(!/^\d+$/.test(q.blockNumber) || ![q.amountIn,q.amountOut].every(positive) || !Number.isFinite(q.gasUsd) || q.gasUsd<0)return hold("Invalid quote");
  const slip=1-config.slippageBps/10000;
  if(wantsBuy){
    const cost=q.amountIn+q.gasUsd;
    if(q.amountIn>config.maxPositionUsd || cost>state.cashUsd)return hold("Quote exceeds paper position limit or available cash including gas");
    const units=q.amountOut*slip;
    state.cashUsd-=cost;state.position={units,costUsd:cost,openedAt:observation.observedAt};state.trades++;
    return {action:"buy",reason:"Simulated quote-based purchase; no order sent",state,fill:{side:"buy",at:observation.observedAt,units,cashChangeUsd:-cost,gasUsd:q.gasUsd}};
  }
  const position=state.position!;
  if(Math.abs(q.amountIn-position.units)>Math.max(1e-12,position.units*1e-9))return hold("Sell quote does not cover the exact simulated position");
  if(q.gasUsd>state.cashUsd)return hold("Insufficient paper cash reserved for exit gas");
  const proceeds=q.amountOut*slip-q.gasUsd;
  const pnl=proceeds-position.costUsd;
  state.cashUsd+=proceeds;state.realizedPnlUsd+=pnl;state.dailyRealizedPnlUsd+=pnl;state.position=null;state.trades++;
  return {action:"sell",reason:expired?"Simulated time exit at the current quote; missed periods were not backfilled":"Simulated signal exit; no order sent",state,fill:{side:"sell",at:observation.observedAt,units:position.units,cashChangeUsd:proceeds,gasUsd:q.gasUsd,realizedPnlUsd:pnl}};
}
