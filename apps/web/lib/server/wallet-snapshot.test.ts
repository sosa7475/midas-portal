import { test } from "node:test";
import assert from "node:assert/strict";
import { trackedBaseTokens, walletSnapshot } from "./wallet-snapshot";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const aero = "0x940181a94a35a4569e4529a3cdfb74e38fd98631";
const reads = { native: async()=>4499227652867049n, usdc: async()=>0n, ethPrice: async()=>2540,
  token: async()=>({ balance:2216123890831917223n, decimals:18 }) };
test("existing purchased token is discovered without mixing chains or duplicates",()=>{
 const rows=[{kind:"trade",metrics:{chain:"base",tokenInAddr:usdc,tokenOutAddr:aero}},
 {kind:"trade",metrics:{chain:"ethereum",tokenOutAddr:"0x4200000000000000000000000000000000000006"}}];
 assert.deepEqual(trackedBaseTokens(rows,[aero],usdc),[aero]);
 assert.throws(()=>trackedBaseTokens(rows,["ETH"],usdc));
});
test("exact held amounts and limited valuation remain explicit",async()=>{
 const r=await walletSnapshot([aero],reads);
 assert.equal(r.tokens[0].balance,"2.216123890831917223");
 assert.equal(r.ethExact,"0.004499227652867049");
 assert.equal(r.coreValueUsd,11.43);assert.equal(r.valueUsd,null);assert.equal(r.inventoryComplete,false);
});
test("RPC failures do not become zero balances or a complete valuation",async()=>{
 const fail=async()=>{throw Error("provider down")};
 const r=await walletSnapshot([aero],{...reads,native:fail,token:fail});
 assert.equal(r.eth,null);assert.equal(r.ethRaw,null);assert.equal(r.coreValueUsd,null);
 assert.equal(r.tokens[0].balance,null);assert.equal(r.errors.length,2);assert.equal(r.usdc,0);
});
test("missing price cannot value held ETH as zero dollars",async()=>{
 const r=await walletSnapshot([],{...reads,ethPrice:async()=>null});
 assert.equal(r.coreValueUsd,null);assert.ok(r.errors.includes("ETH price unavailable"));
});


test("legacy Midas purchase fields discover the actual AERO holding",()=>{
 const row={kind:"trade",metrics:{chain:"base",venue:"uniswap",tokenIn:"eth",tokenOut:"0x940181a94a35a4569e4529a3cdfb74e38fd98631",amountIn:0.0005,amountOut:"2.216123890831917223"}};
 assert.deepEqual(trackedBaseTokens([row],undefined,usdc),[aero]);
 // Human symbols are not contracts and must not be passed to the RPC.
 assert.deepEqual(trackedBaseTokens([{kind:"trade",metrics:{chain:"base",tokenIn:"ETH",tokenOut:"USDC"}}],undefined,usdc),[]);
});
