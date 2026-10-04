import {test,mock} from "node:test";
import assert from "node:assert/strict";
import * as db from "./db";
import * as risk from "./agent-risk-sql";
import {executeOnce} from "./execution-orders";
const id="11111111-1111-4111-8111-111111111111",ctx={userId:"u",agentId:"a"};

test("manual approval, tenant scope, expiry and replay are enforced before dispatch",async()=>{
 let row:any={id,kind:"swap",status:"proposed",payload:{},approval:null,expires_at:new Date(Date.now()+60000)};
 let calls=0;
 const riskMock=mock.method(risk,"getRisk",async()=>risk.RISK_DEFAULTS);
 const tx=mock.method(db,"transaction",async(work:any)=>work({query:async(sql:string,args:any[])=>{
  if(sql.startsWith("SELECT * FROM execution_orders")){assert.deepEqual(args,[id,"u","a"]);return {rows:row?[{...row}]:[]};}
  if(sql.includes("SELECT config FROM agent_risk"))return {rows:[{config:risk.RISK_DEFAULTS}]};
  if(sql.includes("count(*)"))return {rows:[{n:0}]};
  if(sql.startsWith("UPDATE execution_orders"))row.status="submitting";
  return {rows:[]};
 }}));
 const q=mock.method(db,"query",async(sql:string,args:any[])=>{if(sql.includes("status=$2")){row.status=args[1];row.result=JSON.parse(args[2]);}if(sql.includes("status='unknown'"))row.status="unknown";return {rows:[]};});
 const dispatch=async()=>{calls++;return {placed:true,status:"filled"};};
 try {
  await assert.rejects(executeOnce(ctx,id,"swap",dispatch),/approval required/);assert.equal(calls,0);
  row.approval="owner";row.expires_at=new Date(0);await assert.rejects(executeOnce(ctx,id,"swap",dispatch),/expired/);
  row.expires_at=new Date(Date.now()+60000);await executeOnce(ctx,id,"swap",dispatch);assert.equal(calls,1);
  const again=await executeOnce(ctx,id,"swap",dispatch);assert.equal(again.duplicate,true);assert.equal(calls,1);
  row=null;await assert.rejects(executeOnce(ctx,id,"swap",dispatch),/not found/);
 }finally{for(const m of [riskMock,tx,q])m.mock.restore();}
});

test("submission uncertainty stays locked and cannot dispatch twice",async()=>{
 let evidence=false,calls=0;
 let row:any={id,kind:"swap",status:"approved",payload:{},approval:"owner",expires_at:new Date(Date.now()+60000)};
 const r=mock.method(risk,"getRisk",async()=>risk.RISK_DEFAULTS);
 const tx=mock.method(db,"transaction",async(work:any)=>work({query:async(sql:string)=>{
  if(sql.startsWith("SELECT * FROM execution_orders"))return {rows:[{...row}]};
  if(sql.includes("SELECT config FROM agent_risk"))return {rows:[{config:risk.RISK_DEFAULTS}]};
  if(sql.includes("count(*)"))return {rows:[{n:0}]};
  if(sql.startsWith("UPDATE execution_orders"))row.status="submitting";
  return {rows:[]};
 }}));
 const q=mock.method(db,"query",async(sql:string,args:any[])=>{
  if(sql.startsWith("SELECT 1 FROM execution_events"))return {rows:evidence?[{}]:[]};
  if(sql.includes("status=$3"))row.status=args[2];return {rows:[]};
 });
 try{
  const dispatch=async()=>{calls++;throw Error("Provider timed out");};
  await assert.rejects(executeOnce(ctx,id,"swap",dispatch),/timed out/);assert.equal(row.status,"blocked");
  row.status="approved";evidence=true;
  await assert.rejects(executeOnce(ctx,id,"swap",dispatch),/timed out/);assert.equal(row.status,"unknown");
  assert.equal((await executeOnce(ctx,id,"swap",dispatch)).duplicate,true);assert.equal(calls,2);
 }finally{for(const m of [r,tx,q])m.mock.restore();}
});
