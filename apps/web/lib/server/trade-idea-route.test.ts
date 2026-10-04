import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {NextRequest,NextResponse} from "next/server";
import * as auth from "./auth";
import * as db from "./db";
import * as ideas from "./trade-ideas";
import * as tools from "./mcp-tools";
import * as execution from "./execution-orders";
import {POST} from "../../app/api/agents/[id]/trade-ideas/route";
const id="11111111-1111-4111-8111-111111111111",ideaId="22222222-2222-4222-8222-222222222222";
const url=`https://midas.test/api/agents/${id}/trade-ideas`;
const context=()=>({params:Promise.resolve({id})});
test("idea submission requires browser session cookie and matching origin",async()=>{
  for(const headers of ([{origin:"https://midas.test"},{cookie:"midas_token=x",origin:"https://other.test"}] as Record<string,string>[])){
    const r=await POST(new NextRequest(url,{method:"POST",headers,body:JSON.stringify({ideaId})}),context());assert.equal(r.status,403);
  }
});
test("human submission uses stored terms, not client-supplied size or output",async()=>{
  const a=mock.method(auth,"getSession",()=>({userId:"user-1",email:"test@example.test"}));
  const q=mock.method(db,"query",async()=>({rows:[{}]}));
  const p={tokenIn:"eth",tokenOut:"0x123",amountIn:"0.0005",minimumOutRaw:"12345",slippagePct:0.3,expiresAt:"2026-09-12T20:00:00Z"};
  const c=mock.method(ideas,"claimTradeIdea",async(u:string,agent:string,idea:string)=>{assert.deepEqual([u,agent,idea],["user-1",id,ideaId]);return p;});
  const f=mock.method(ideas,"finishTradeIdea",async()=>{});
  const approved=mock.method(execution,"approveExecution",async()=>{});
  const s=mock.method(tools,"callTool",async (name:string,b:any)=>{
    if(name==="execute_swap")return {placed:true,swapTx:"mock-hash"};
    assert.equal(name,"propose_swap");assert.deepEqual(b,{chain:"base",tokenIn:p.tokenIn,tokenOut:p.tokenOut,amountIn:p.amountIn,
      slippagePct:p.slippagePct,minimumOutRaw:p.minimumOutRaw,validUntilMs:Date.parse(p.expiresAt),requestKey:`idea:${ideaId}`});
    return {intent:"reserved-order"};
  });
  try{
    const r=await POST(new NextRequest(url,{method:"POST",headers:{cookie:"midas_token=test",origin:"https://midas.test"},body:JSON.stringify({ideaId,amountIn:"999999",tokenOut:"attacker"})}),context());
    assert.equal((await r.json()).swapTx,"mock-hash");assert.equal(s.mock.callCount(),2);assert.equal(f.mock.callCount(),1);
  }finally{for(const h of [a,q,c,f,s,approved])h.mock.restore();}
});
