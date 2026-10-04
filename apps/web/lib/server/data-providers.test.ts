import {test,mock} from "node:test";
import assert from "node:assert/strict";
import {rhAssets} from "./robinhood";
import {onchain} from "./moralis";

test("HOOD lookup does not match every Robinhood-branded token",async()=>{
 const m=mock.method(globalThis,"fetch",async()=>new Response(JSON.stringify({assets:[{tokenSymbol:"AAPL",tokenName:"Apple • Robinhood Token"},{tokenSymbol:"HOOD",tokenName:"Robinhood Markets • Robinhood Token"}]})));
 try{const r=await rhAssets("HOOD");assert.equal(r.count,1);assert.equal(r.assets![0].symbol,"HOOD");}finally{m.mock.restore();}
});
test("on-chain prices fall back with provenance and never reuse Ethereum aliases on Base",async()=>{
 const original=process.env.MORALIS_API_KEY;process.env.MORALIS_API_KEY="test";const urls:string[]=[];
 const m=mock.method(globalThis,"fetch",async(url:any)=>{urls.push(String(url));return String(url).includes("moralis")?new Response("unavailable",{status:503}):new Response(JSON.stringify({data:{attributes:{name:"Wrapped Ether",symbol:"WETH",address:"0x4200000000000000000000000000000000000006",price_usd:"2000"}}}));});
 try{
  const r=await onchain("token_price","0x4200000000000000000000000000000000000006","base");assert.equal(r.source,"geckoterminal");assert.equal(r.usdPrice,2000);assert.ok(urls[0].includes("chain=0x2105"));
  const unknown=await onchain("token_price","weth","base");assert.ok(unknown.error);assert.equal(urls.length,2);
 }finally{m.mock.restore();if(original===undefined)delete process.env.MORALIS_API_KEY;else process.env.MORALIS_API_KEY=original;}
});
