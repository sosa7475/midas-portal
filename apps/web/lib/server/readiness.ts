import type {Scope} from "./execution-orders";
import {query} from "./db";
import {getMandate} from "./mandate";
import {getActiveStrategy} from "./strategy-sql";
import {judge} from "./strategy-review";
import {getRisk} from "./agent-risk-sql";
import {operationStatus} from "./operations";
import {loadHlPublic} from "./hl-sql";
import {loadKeysetPublic} from "./turnkey-sql";
export async function getReadiness(ctx:Scope){
 const [mandate,strategy,risk,ops,hl,wallet,unknown]=await Promise.all([getMandate(ctx.userId,ctx.agentId),getActiveStrategy(ctx.userId,ctx.agentId),getRisk(ctx.userId,ctx.agentId),operationStatus(ctx),loadHlPublic(ctx.userId,ctx.agentId),loadKeysetPublic(ctx.userId,ctx.agentId),query("SELECT id,status FROM execution_orders WHERE user_id=$1 AND agent_id=$2 AND status IN ('unknown','review_required')",[ctx.userId,ctx.agentId])]);
 const fresh=Number.isFinite(Date.parse(strategy?.metrics?.evaluatedAt))&&Date.now()-Date.parse(strategy?.metrics?.evaluatedAt)<7*86400000;
 const verdict=judge(null,{ok:!!strategy,oos:strategy?.metrics?.challenger});
 const blockers=[];
 if(!mandate?.enabled||Date.parse(mandate.expiresAt)<=Date.now())blockers.push("Owner mandate absent or expired");
 if(!fresh||!verdict.win)blockers.push("Active strategy requires fresh qualifying held-out evidence");
 if(strategy?.version!==mandate?.strategyVersion)blockers.push("Mandate does not match active strategy");
 if(!risk.autoExecute||risk.paused)blockers.push("Automatic entry execution disabled or paused");
 if(mandate?.venues.includes("hyperliquid")&&(!hl?.tradingEnabled||hl.network!=="mainnet"))blockers.push("Approved mainnet Hyperliquid API wallet required");
 if(!ops.healthy)blockers.push("Research or execution-monitor heartbeat missing/stale");
 if(unknown.rows.length)blockers.push("Orders need reconciliation/review");
 return {automaticEntriesEligible:blockers.length===0,blockers,strategy:{version:strategy?.version??null,fresh,qualified:verdict.win,reason:verdict.reason},account:{evmConnected:!!wallet,hyperliquid:hl?{network:hl.network,address:hl.address,tradingEnabled:hl.tradingEnabled===true}:null},providers:{moralis:!!process.env.MORALIS_API_KEY,finnhub:!!process.env.FINNHUB_API_KEY,workerModel:!!process.env.OPENAI_API_KEY},operations:ops,note:"Eligibility is not proof of funding, a liquid route, deployed signer policies, or a profitable strategy. Account and quote checks still run before each order."};
}
