import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {checkExitRule,exitTriggered} from "./spot-exit-policy";
import {hlOrderState,protectiveIds} from "./hl-reconciliation";
import {estimatedNetworkFee,receiptNetworkFee} from "./network-fees";
import {fifoAccounting} from "./accounting";
import {CHAINS} from "./dex";
import {validateSchema} from "./json-schema";
import {MCP_TOOLS} from "./mcp-tools";
import {permitted} from "./mcp-permissions";

test("exit triggers use raw amounts and never enlarge authorized size",()=>{
 assert.equal(exitTriggered(99n,100n,200n),true);assert.equal(exitTriggered(150n,100n,200n),false);assert.equal(exitTriggered(201n,100n,200n),true);
 const p={chain:"base",account:"0xaa",tokenIn:"0xbb",tokenOut:"0xcc",amountInHuman:"1",decimalsIn:18,slippagePct:0.5,gasReserveEth:"0.001",maxGasEth:"0.001",nativeIn:false};
 const r={status:"executing",expires_at:new Date(Date.now()+60000),chain:p.chain,account:p.account,token_in:p.tokenIn,token_out:p.tokenOut,amount_raw:"1000000000000000000",slippage_pct:0.5,gas_reserve_eth:p.gasReserveEth,max_gas_eth:p.maxGasEth};
 assert.doesNotThrow(()=>checkExitRule(r,p));
 for(const patch of [{amountInHuman:"2"},{account:"another"},{tokenOut:"another"},{nativeIn:true},{maxGasEth:"1"}])assert.throws(()=>checkExitRule(r,{...p,...patch}));
 assert.throws(()=>checkExitRule({...r,status:"revoked"},p));assert.throws(()=>checkExitRule({...r,expires_at:new Date(0)},p));
});
test("partial and cancelled partial perp fills retain executed quantity",()=>{
 assert.deepEqual(hlOrderState({status:"order",order:{status:"open",order:{origSz:"2",sz:"1"}}}),{status:"partially_filled",filledSize:1});
 assert.equal(hlOrderState({status:"order",order:{status:"canceled",order:{origSz:"2",sz:"1"}}}).status,"partially_filled");
 assert.equal(hlOrderState({status:"unknownOid"}).status,"unknown");
 const ids=protectiveIds("11111111-1111-4111-8111-111111111111",{stopLoss:1,takeProfit:2},"trade");assert.equal(new Set(ids).size,2);
});
test("fee budgets include OP data/operator costs but do not double count Arbitrum data",async()=>{
 const client={readContract:async({functionName}:any)=>functionName==="getL1Fee"?10n:5n};
 assert.equal(await estimatedNetworkFee(client,"base",{gas:100n,maxFeePerGas:2n},"0x12"),230n);
 assert.equal(await estimatedNetworkFee(client,"robinhood",{gas:100n,maxFeePerGas:2n},"0x12"),200n);
 assert.equal(await receiptNetworkFee({},"robinhood",{gasUsed:10n,effectiveGasPrice:2n}),20n);
 assert.equal(await receiptNetworkFee({},"base",{gasUsed:10n,effectiveGasPrice:2n}),null);
});
test("FIFO ledger does not invent basis for external inventory or missing fees",()=>{
 const token="0x1111111111111111111111111111111111111111",usdc=CHAINS.base.usdc;
 const row={chain:"base",account:"0xaa",order_id:"1",token_in:usdc,token_out:token,input_raw:"10000000",output_raw:"100",decimals_in:6,decimals_out:0,fee_wei:"100"};
 const result=fifoAccounting([row,{...row,order_id:"2",token_in:token,token_out:usdc,input_raw:"50",output_raw:"8000000",decimals_in:0,decimals_out:6}]);
 assert.equal(result.realizedBeforeNetworkFees[0].amount,"3");assert.equal(result.openLots[0].quantityRaw,"50");
 const unknown=fifoAccounting([{...row,token_in:token,token_out:usdc,fee_wei:null}]);assert.equal(unknown.unmatchedOrderIds.length,1);assert.equal(unknown.networkFeesEth,null);assert.equal(unknown.complete,false);
});
test("MCP catalog exposes object conditions, exact decimal amounts and explicit permissions",()=>{
 const swap=MCP_TOOLS.find(t=>t.name==="propose_swap")!;
 assert.doesNotThrow(()=>validateSchema(swap.inputSchema,{tokenIn:"eth",tokenOut:"usdc",amountIn:"0.1"}));
 assert.throws(()=>validateSchema(swap.inputSchema,{tokenIn:"eth",tokenOut:"usdc",amountIn:0.1}));
 const bt=MCP_TOOLS.find(t=>t.name==="backtest_strategy")!;
 assert.equal(bt.inputSchema.properties.entryLong.items.type,"object");
 assert.equal(permitted("execute_swap",["read","propose"]),false);assert.equal(permitted("execute_swap",["execute"]),true);
 assert.ok(MCP_TOOLS.some(t=>t.name==="get_readiness"));
});
