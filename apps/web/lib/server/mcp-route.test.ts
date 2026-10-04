import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {NextRequest} from "next/server";
import {POST,GET} from "../../app/api/mcp/route";
import * as auth from "./mcp-auth";
import * as rate from "./ratelimit";
import * as tools from "./mcp-tools";

test("MCP rejects cross-origin calls, query credentials, batches and executable notifications",async()=>{
 let calls=0;const a=mock.method(auth,"resolveMcpToken",async()=>({userId:"u",agentId:"a",connectorId:"c",scopes:["read","propose"]}));
 const r=mock.method(rate,"rateLimit",async()=>true);const t=mock.method(tools,"callTool",async()=>{calls++;return {};});
 const req=(body:any,headers:any={},url="https://midas.test/api/mcp")=>new NextRequest(url,{method:"POST",headers:{authorization:"Bearer test","content-type":"application/json",...headers},body:JSON.stringify(body)});
 try{
  assert.equal((await POST(req({jsonrpc:"2.0",id:1,method:"ping"},{origin:"https://evil.test"}))).status,403);
  assert.equal((await POST(req({jsonrpc:"2.0",method:"tools/call",params:{name:"execute_swap"}}))).status,400);
  assert.equal((await POST(req([]))).status,400);
  assert.equal((await POST(req({jsonrpc:"2.0",method:"notifications/initialized"}))).status,202);
  assert.equal((await POST(req({jsonrpc:"2.0",id:1,method:"ping"},{authorization:""},"https://midas.test/api/mcp?key=test"))).status,401);
  assert.equal((await POST(req({jsonrpc:"2.0",id:1,method:"ping"},{"mcp-protocol-version":"made-up"}))).status,400);
  assert.equal((await GET(new NextRequest("https://midas.test/api/mcp",{headers:{authorization:"Bearer test"}}))).status,405);
  assert.equal(calls,0);
 }finally{for(const m of [a,r,t])m.mock.restore();}
});
test("MCP scopes filter catalog and cannot be bypassed by direct tools/call",async()=>{
 const a=mock.method(auth,"resolveMcpToken",async()=>({userId:"u",agentId:"a",connectorId:"c",scopes:["read"]}));const r=mock.method(rate,"rateLimit",async()=>true);
 let called=false;const t=mock.method(tools,"callTool",async()=>{called=true;return {error:"Provider unavailable"};});
 const req=(method:string,params?:unknown)=>new NextRequest("https://midas.test/api/mcp",{method:"POST",headers:{authorization:"Bearer test","content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method,params})});
 try{
  const list=await (await POST(req("tools/list"))).json();assert.ok(list.result.tools.some((x:any)=>x.name==="get_readiness"));assert.ok(!list.result.tools.some((x:any)=>x.name==="execute_swap"));
  const denied=await (await POST(req("tools/call",{name:"execute_swap",arguments:{intent:"x"}}))).json();assert.equal(denied.error.code,-32602);assert.equal(called,false);
  const invalid=await (await POST(req("tools/call",{name:"onchain_data",arguments:{kind:"unknown",address:"x"}}))).json();assert.equal(invalid.result.isError,true);assert.equal(called,false);
  const unavailable=await (await POST(req("tools/call",{name:"get_wallet",arguments:{}}))).json();assert.equal(unavailable.result.isError,true);
 }finally{for(const m of [a,r,t])m.mock.restore();}
});
