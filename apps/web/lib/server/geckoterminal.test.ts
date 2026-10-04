import {test} from "node:test";
import assert from "node:assert/strict";
import {gtSearch,dexAnalytics} from "./geckoterminal";
const pool=(id:string,network?:string)=>({id,attributes:{name:"TOKEN / WETH",address:"0x123",base_token_price_usd:"1",reserve_in_usd:"1000",volume_usd:{h24:"20"}},relationships:network?{network:{data:{id:network}}}:{}});
async function mocked(rows:any[],run:(urls:URL[])=>Promise<void>){const previous=globalThis.fetch;const urls:URL[]=[];globalThis.fetch=async(input)=>{urls.push(new URL(String(input)));return Response.json({data:rows});};try{await run(urls);}finally{globalThis.fetch=previous;}}
test("dispatcher sends Base filter and excludes wrong or unknown chain results before applying limit",async()=>{
 await mocked([pool("eth_a"),pool("unknown"),pool("base_b"),pool("base_c")],async urls=>{
 const r:any=await dexAnalytics({kind:"search",query:"VIRTUAL",network:"base",limit:1});
 assert.equal(urls[0].searchParams.get("network"),"base");assert.equal(r.results.length,1);assert.equal(r.results[0].network,"base");
 });
});
test("conflicting chain identifiers are not returned",async()=>{
 await mocked([pool("base_a","eth"),pool("base_b","base")],async()=>{const r=await gtSearch("X","base");assert.equal(r.length,1);assert.equal(r[0].network,"base");});
});
test("network aliases normalize and query text remains encoded",async()=>{
 await mocked([pool("eth_a")],async urls=>{await gtSearch("A&B","ethereum");assert.equal(urls[0].searchParams.get("network"),"eth");assert.equal(urls[0].searchParams.get("query"),"A&B");});
});
test("unfiltered searches retain network labels and the eight-result cap",async()=>{
 await mocked(Array.from({length:12},(_,i)=>pool(`base_${i}`)),async urls=>{const r=await gtSearch("X",undefined,20);assert.equal(r.length,8);assert.equal(r[0].network,"base");assert.equal(urls[0].searchParams.has("network"),false);});
});
test("invalid limits fail before network calls",async()=>{
 await mocked([],async urls=>{for(const limit of [0,-1,1.2,NaN])await assert.rejects(gtSearch("X","base",limit));assert.equal(urls.length,0);});
});
