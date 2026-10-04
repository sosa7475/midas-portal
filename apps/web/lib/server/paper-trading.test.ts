import {test} from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createPaperState,stepPaper,type PaperConfig,type PaperObservation} from "./paper-trading";
import {recordPaperObservation} from "./paper-journal";

const config:PaperConfig={strategyId:"unit-test",strategyDigest:"frozen-test-rules",initialCashUsd:10,maxPositionUsd:5,maxDailyRealizedLossUsd:.1,slippageBps:10,maxQuoteAgeMs:30000,maxHoldingMs:3600000,researchApproved:true};
const now=Date.UTC(2026,8,12,15);
const buy:PaperObservation={id:"1",observedAt:now,signalKnownAt:now-1000,signal:"buy",quote:{side:"buy",observedAt:now,blockNumber:"100",blockTime:now,amountIn:5,amountOut:.002,gasUsd:.01,costsComplete:true}};
const enter=()=>stepPaper(config,createPaperState(config),buy);

test("round-trip paper PnL deducts slippage and gas on both sides",()=>{
 const a=enter();assert.equal(a.action,"buy");assert.equal(a.state.cashUsd,4.99);
 const b=stepPaper(config,a.state,{id:"2",observedAt:now+10000,signalKnownAt:now+9000,signal:"sell",quote:{...buy.quote!,side:"sell",observedAt:now+10000,amountIn:a.state.position!.units,amountOut:5.1}});
 assert.equal(b.action,"sell");assert.ok(Math.abs(b.state.cashUsd-10.0749)<1e-10);assert.ok(Math.abs(b.state.realizedPnlUsd-.0749)<1e-10);assert.equal(b.state.position,null);
});
test("no approved candidate means no simulated entry",()=>{
 const c={...config,researchApproved:false};const d=stepPaper(c,createPaperState(c),buy);assert.equal(d.action,"hold");assert.equal(d.state.trades,0);
});
test("duplicate observation cannot produce a second fill",()=>{
 const first=enter();const duplicate=stepPaper(config,first.state,buy);assert.deepEqual(duplicate.state,first.state);
 assert.throws(()=>stepPaper(config,first.state,{...buy,signal:"hold"}),/different data/);
});
test("changed rules require a new paper trial",()=>{
 assert.throws(()=>stepPaper({...config,slippageBps:0},enter().state,{...buy,id:"2",observedAt:now+10000}),/rules changed/);
});
test("unobserved time exits require current quotes, never retroactive fills",()=>{
 const d=stepPaper(config,enter().state,{id:"2",observedAt:now+7200000,signalKnownAt:now+7200000,signal:"hold"});
 assert.equal(d.action,"need_sell_quote");assert.ok(d.state.position);assert.equal(d.state.trades,1);
});
test("stale, future, incomplete-cost and oversized quotes cannot fill",()=>{
 for(const quote of [{...buy.quote!,observedAt:now-60000},{...buy.quote!,observedAt:now+1},{...buy.quote!,costsComplete:false},{...buy.quote!,amountIn:6}])assert.equal(stepPaper(config,createPaperState(config),{...buy,quote}).action,"hold");
 assert.throws(()=>stepPaper(config,enter().state,{...buy,id:"2",observedAt:now-1}),/advance time/);
});
test("daily loss limit blocks new entries but allows liquidation",()=>{
 const a=enter();const b=stepPaper(config,a.state,{id:"2",observedAt:now+10000,signalKnownAt:now+9000,signal:"sell",quote:{...buy.quote!,side:"sell",observedAt:now+10000,amountIn:a.state.position!.units,amountOut:4.5}});
 assert.equal(b.action,"sell");assert.ok(b.state.dailyRealizedPnlUsd<-.1);
 const c=stepPaper(config,b.state,{...buy,id:"3",observedAt:now+20000,quote:{...buy.quote!,observedAt:now+20000}});assert.match(c.reason,/loss limit/);
});
test("journal replays and deduplicates, detects changed history",(t)=>{
 t.mock.method(Date,"now",()=>now);
 const dir=mkdtempSync(join(tmpdir(),"midas-paper-"));const path=join(dir,"journal.jsonl");
 try{
  const first=recordPaperObservation(path,config,buy);const second=recordPaperObservation(path,config,buy);assert.equal(first.sequence,1);assert.equal(second.sequence,1);assert.equal(second.duplicate,true);
  const original=readFileSync(path,"utf8");writeFileSync(path,original.replace('"cashUsd":4.99','"cashUsd":9.99'));
  assert.throws(()=>recordPaperObservation(path,config,{...buy,id:"2",observedAt:now+1}),/integrity/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("first observations cannot be backfilled or future-dated",(t)=>{
 t.mock.method(Date,"now",()=>now);
 const dir=mkdtempSync(join(tmpdir(),"midas-clock-"));const path=join(dir,"journal.jsonl");
 try{
  assert.throws(()=>recordPaperObservation(path,config,{...buy,observedAt:now-60000,signalKnownAt:now-60000}),/freshly/);
  assert.throws(()=>recordPaperObservation(path,config,{...buy,observedAt:now+1}),/freshly/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
