import * as db from "./db";
import {test,mock} from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import {NextRequest} from "next/server";
import {signToken,getSession} from "./auth";
import {checkOrder} from "./risk";
import {checkMandate,mandateSchema} from "./mandate";
import {validSpec} from "./strategy-review";
import {CHAINS} from "./dex";

test("risk rejects non-finite, negative and zero trading values",()=>{
 for(const quantity of [-1,0,NaN,Infinity])assert.equal(checkOrder({price:2500,quantity,equityUsd:100}).ok,false);
 for(const price of [-1,0,NaN])assert.equal(checkOrder({price,quantity:1,equityUsd:100}).ok,false);
 assert.equal(checkOrder({price:1,quantity:1,equityUsd:100}).ok,true);
});
test("OAuth and trade JWTs cannot become owner sessions",async()=>{
 const dbmock=mock.method(db,"query",async()=>({rows:[{}]}));
 const previous=process.env.JWT_SECRET;process.env.JWT_SECRET="test-secret-".repeat(5);
 try{
  const req=(token:string)=>new NextRequest("https://midas.test",{headers:{authorization:`Bearer ${token}`}});
  for(const t of ["oauthcode","oauthrefresh","trade","swap"])assert.equal(await getSession(req(jwt.sign({t,userId:"owner",email:"owner@test"},process.env.JWT_SECRET))),null);
  assert.equal((await getSession(req(await signToken({userId:"owner",email:"owner@test"}))))?.userId,"owner");
  assert.equal(await getSession(req(jwt.sign({t:"session",userId:"owner"},process.env.JWT_SECRET,{issuer:"midas",audience:"midas:session"}))),null);
 }finally{dbmock.mock.restore();if(previous===undefined)delete process.env.JWT_SECRET;else process.env.JWT_SECRET=previous;}
});
test("Hood mandate is bounded by network, assets, version, value and expiry",()=>{
 const m=mandateSchema.parse({enabled:true,expiresAt:new Date(Date.now()+60000).toISOString(),venues:["robinhood"],assets:["0xA","0xB"],maxOrderUsd:5,maxDailyTurnoverUsd:10,maxLeverage:1,maxSlippageBps:50,gasReserveEth:"0.0001",maxGasEth:"0.0001",strategyVersion:2});
 const p={t:"swap",chain:"robinhood",tokenIn:"0xa",tokenOut:"0xb",notionalUsd:4,strategyVersion:2,slippagePct:0.5};
 assert.doesNotThrow(()=>checkMandate(m,p));
 for(const patch of [{chain:"base"},{tokenOut:"other"},{notionalUsd:null},{notionalUsd:6},{strategyVersion:1},{slippagePct:1}])assert.throws(()=>checkMandate(m,{...p,...patch}));
 assert.throws(()=>checkMandate({...m,enabled:false},p));assert.throws(()=>checkMandate(m,p,Date.now()+120000));
});
test("Robinhood Chain execution uses a distinct network and verified v3 contracts",()=>{
 assert.equal(CHAINS.robinhood.id,4663);assert.notEqual(CHAINS.robinhood.router,CHAINS.base.router);
 assert.equal(CHAINS.robinhood.router.toLowerCase(),"0xcaf681a66d020601342297493863e78c959e5cb2");
 assert.equal(CHAINS.robinhood.usdc,undefined);
});
test("strategy rejects malformed and unknown indicators",()=>{
 const s={symbol:"ETH",interval:"4h",direction:"long",riskPct:1,entryLong:[{left:{ind:"close"},op:">",right:{value:1}}]};
 assert.equal(validSpec(s),null);assert.ok(validSpec({...s,entryLong:["bad"]}));
 assert.ok(validSpec({...s,entryLong:[{left:{ind:"made_up"},op:">",right:{value:1}}]}));
});

test("execution inputs reject coercion, arbitrary networks and invalid intents",async()=>{
 const {validateExecutionInput}=await import("./execution-input");
 assert.doesNotThrow(()=>validateExecutionInput("propose_swap",{chain:"robinhood",tokenIn:"eth",tokenOut:"weth",amountIn:"0.00001"}));
 for(const amountIn of [1,"-1","NaN","0",""])
  assert.throws(()=>validateExecutionInput("propose_swap",{tokenIn:"eth",tokenOut:"weth",amountIn}));
 assert.throws(()=>validateExecutionInput("propose_trade",{symbol:"ETH",side:"other",quantity:1}));
 assert.throws(()=>validateExecutionInput("execute_swap",{intent:"old.jwt.intent"}));
 assert.throws(()=>validateExecutionInput("propose_position_action",{symbol:"ETH",action:"protection"}));
});
test("swap signer policy binds the ABI recipient and network",async()=>{
 const {swapPolicyCondition}=await import("./signing-policy");
 const {encodeFunctionData,parseAbi}=await import("viem");
 const owner="0x1111111111111111111111111111111111111111";
 const data=encodeFunctionData({abi:parseAbi(["function exactInputSingle((address tokenIn,address tokenOut,uint24 fee,address recipient,uint256 amountIn,uint256 amountOutMinimum,uint160 sqrtPriceLimitX96) params) payable returns (uint256)"]),functionName:"exactInputSingle",args:[{tokenIn:owner,tokenOut:owner,fee:3000,recipient:owner,amountIn:1n,amountOutMinimum:1n,sqrtPriceLimitX96:0n}]});
 const condition=swapPolicyCondition([{chainId:4663,router:CHAINS.robinhood.router}],owner);
 assert.ok(condition.includes(data.slice(0,10)));assert.ok(condition.includes(data.slice(202,266)));
 assert.ok(condition.includes("eth.tx.chain_id == 4663"));
});
