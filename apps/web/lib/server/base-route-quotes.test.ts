import {test} from "node:test";
import assert from "node:assert/strict";
import {compareBaseRoutes, type BaseRouteInput} from "./base-route-quotes";
const tokenIn="0x4200000000000000000000000000000000000006",tokenOut="0xacfe6019ed1a7dc6f7b508c02d1b04ec88cc21bf",pool="0x7ec6c9d993d9832aa654593f2dbc21303650bc6c";
const input={tokenIn,tokenOut,amountInRaw:500n,slipstreamPools:[pool]} as const;
function fixture(opts:{wrongFactory?:boolean;wrongPair?:boolean;stale?:boolean;reorg?:boolean;zero?:boolean;wrongChain?:boolean}={}){
 const seen:any[]=[];let blocks=0;
 const client:any={getChainId:async()=>opts.wrongChain?1:8453,getBlock:async()=>({number:7n,hash:opts.reorg&&blocks++>0?"changed":"original",timestamp:BigInt(Math.floor(Date.now()/1000)-(opts.stale?120:0))}),
 readContract:async(p:any)=>{seen.push(p);assert.equal(p.blockNumber,7n);switch(p.functionName){case"factory":return opts.wrongFactory?tokenIn:"0x5e7BB104d84c7CB9B682AaC2F3d509f5F406809A";case"token0":return tokenIn;case"token1":return opts.wrongPair?pool:tokenOut;case"tickSpacing":return 100;case"getPool":return pool;}},
 simulateContract:async(p:any)=>{seen.push(p);assert.equal(p.blockNumber,7n);const slip=p.args[0].tickSpacing!==undefined;return {result:[opts.zero?0n:slip?600n:550n,0n,0,slip?200n:100n]};}};
 return {client,seen};
}
const args=(): BaseRouteInput=>({...input,slipstreamPools:[pool]});
test("compares both venues at one block and preserves raw-unit output",async()=>{
 const f=fixture();const r=await compareBaseRoutes(args(),f.client);assert.equal(r.best.venue,"aerodrome-slipstream");assert.equal(r.best.amountOutRaw,"600");assert.equal(r.quotes.length,5);assert.equal(r.blockNumber,"7");
});
test("wrong factory or token pair is excluded before a Slipstream quote",async()=>{
 for(const option of [{wrongFactory:true},{wrongPair:true}]){const f=fixture(option);const r=await compareBaseRoutes(args(),f.client);assert.equal(r.quotes.length,4);assert.equal(r.unavailable.length,1);assert.ok(!f.seen.some(x=>x.args?.[0]?.tickSpacing!==undefined));}
});
test("wrong chain, stale block and reorg reject results",async()=>{
 for(const option of [{wrongChain:true},{stale:true},{reorg:true}])await assert.rejects(compareBaseRoutes(args(),fixture(option).client));
});
test("all zero outputs cannot produce a recommended route",async()=>{
 await assert.rejects(compareBaseRoutes(args(),fixture({zero:true}).client),/No verified/);
});
test("invalid amount fails before contacting the provider",async()=>{
 const f=fixture();await assert.rejects(compareBaseRoutes({...args(),amountInRaw:0n},f.client),/amount/);assert.equal(f.seen.length,0);
});
