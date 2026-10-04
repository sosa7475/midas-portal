import {test} from "node:test";
import assert from "node:assert/strict";
import {CHAINS,getDecimals,quoteSwap} from "./dex";

test("invalid swap inputs fail before requesting blockchain data",async()=>{
 const original=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{calls++;throw new Error("unexpected network request");};
 try {
  for(const amount of ["0","-1","NaN","1e-3","0.0000001"]){
   await assert.rejects(quoteSwap("base",CHAINS.base.usdc!,CHAINS.base.wnative,amount,6,18));
  }
  await assert.rejects(quoteSwap("base",CHAINS.base.usdc!,CHAINS.base.usdc!,"1",6,6));
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test("zero-decimal tokens retain zero decimals",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{
  const request=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result:"0x"+"0".repeat(64)}),{headers:{"content-type":"application/json"}});
 };
 try{assert.equal(await getDecimals("base",CHAINS.base.usdc!),0);}
 finally{globalThis.fetch=original;}
});

test("unreadable token decimals fail instead of guessing eighteen",async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async(_input,init)=>{
  const request=JSON.parse(String(init?.body));
  return new Response(JSON.stringify({jsonrpc:"2.0",id:request.id,result:"0x"}),{headers:{"content-type":"application/json"}});
 };
 try{await assert.rejects(getDecimals("base",CHAINS.base.usdc!));}
 finally{globalThis.fetch=original;}
});
