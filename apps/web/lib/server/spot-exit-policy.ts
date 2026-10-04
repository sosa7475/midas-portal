import {z} from "zod";
import {parseUnits} from "viem";
export const exitRuleSchema=z.object({
 chain:z.enum(["base","robinhood"]),tokenIn:z.string().regex(/^0x[0-9a-fA-F]{40}$/),tokenOut:z.string().regex(/^0x[0-9a-fA-F]{40}$/),
 amount:z.string().regex(/^\d+(\.\d{1,18})?$/),stopOutput:z.string().regex(/^\d+(\.\d{1,18})?$/),targetOutput:z.string().regex(/^\d+(\.\d{1,18})?$/).optional(),
 slippagePct:z.number().finite().min(0).max(3),gasReserveEth:z.string().regex(/^\d+(\.\d{1,18})?$/),maxGasEth:z.string().regex(/^\d+(\.\d{1,18})?$/),expiresAt:z.string().datetime()
}).strict();
export function exitTriggered(amountOut:bigint,stop:bigint,target:bigint|null){return amountOut<=stop||(target!==null&&amountOut>=target);}
export function checkExitRule(rule:any,p:any,now=Date.now()){
 if(!rule||rule.status!=="executing"||new Date(rule.expires_at).getTime()<=now)throw Error("Exit authorization revoked or expired");
 if(rule.chain!==p.chain||rule.account.toLowerCase()!==p.account.toLowerCase()||rule.token_in.toLowerCase()!==p.tokenIn.toLowerCase()||rule.token_out.toLowerCase()!==p.tokenOut.toLowerCase()||parseUnits(p.amountInHuman,p.decimalsIn)!==BigInt(rule.amount_raw)||p.nativeIn||Number(rule.slippage_pct)!==p.slippagePct||rule.max_gas_eth!==p.maxGasEth||rule.gas_reserve_eth!==p.gasReserveEth)throw Error("Exit order terms differ from owner authorization");
}
