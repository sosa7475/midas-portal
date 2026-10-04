import {test} from "node:test";
import assert from "node:assert/strict";
import {quoteBaseRouteTool} from "./base-route-tool";
test("invalid amounts, identical assets and malformed pools fail without network requests",async()=>{
 const original=globalThis.fetch;let calls=0;globalThis.fetch=async()=>{calls++;throw Error("unexpected network call")};
 try{
 const base={tokenIn:"ETH",tokenOut:"0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf",amountIn:"0.0005"};
 for(const amountIn of ["0","-1","1e-3","NaN",""]){await assert.rejects(quoteBaseRouteTool({...base,amountIn}));}
 await assert.rejects(quoteBaseRouteTool({...base,tokenOut:"ETH"}));
 await assert.rejects(quoteBaseRouteTool({...base,slipstreamPools:["invalid" as `0x${string}`]}));
 assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});
