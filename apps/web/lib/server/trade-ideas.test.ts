import { test, mock } from "node:test";
import assert from "node:assert/strict";
import * as db from "./db";
import * as dex from "./dex";
import { tradeIdeaInput, publishTradeIdea, claimTradeIdea } from "./trade-ideas";
const input={ideaKey:"observation-1",tokenIn:"usdc",tokenOut:"eth",amountIn:"1.123456",slippageBps:30,strategyVersion:"research-v1",rationale:"Example rationale for review",exitPlan:"Review on signal reversal",invalidation:"Discard when quote expires",evidence:"Exploratory evidence; profitability not established"};
test("structured ideas reject missing evidence, numeric rounding and execution-mode injection",()=>{
  assert.equal(tradeIdeaInput.parse(input).amountIn,"1.123456");
  for(const patch of [{amountIn:1.123456},{amountIn:"1e3"},{amountIn:"0"},{slippageBps:-1},{slippageBps:301},{exitPlan:""},{autoExecute:true}])assert.equal(tradeIdeaInput.safeParse({...input,...patch}).success,false);
});
test("publishing stores a review-only WETH idea with exact minimum; retry does not create another",async()=>{
  let stored:any=null,quotes=0;
  const q=mock.method(dex,"quoteSwap",async()=>{quotes++;return {amountOut:"0.0005",amountOutRaw:500000000000000n,fee:3000,blockNumber:"123"} as any;});
  const dec=mock.method(dex,"getDecimals",async(_chain:string,address:string)=>address===dex.CHAINS.base.usdc?6:18);
  const sql=mock.method(db,"query",async(text:string,params?:unknown[])=>{
    if(text.startsWith("CREATE"))return {rows:[]};
    if(text.startsWith("SELECT id,status"))return {rows:stored?[stored]:[]};
    if(text.startsWith("INSERT")){
      assert.match(text,/ON CONFLICT.*DO NOTHING/s);assert.match(text,/user_id=\$1 AND id=\$2/);
      stored={id:"idea-1",status:"pending_review",proposal:JSON.parse(params![2] as string),input_digest:params![5]};return {rows:[stored]};
    }throw Error("Unexpected database operation");
  });
  try{
    const result:any=await publishTradeIdea("user-1","agent-1",input);
    assert.equal(result.submitted,false);assert.equal(stored.proposal.tokenOutLabel,"WETH");assert.equal(stored.proposal.minimumOutRaw,"498500000000000");assert.equal(stored.proposal.deliveryMode,"human_review_only");
    const again:any=await publishTradeIdea("user-1","agent-1",input);assert.equal(again.duplicate,true);assert.equal(quotes,1);
    await assert.rejects(publishTradeIdea("user-1","agent-1",{...input,amountIn:"2"}),/different terms/);
  }finally{q.mock.restore();dec.mock.restore();sql.mock.restore();}
});
test("claim operation is scoped and conditional on pending, unexpired status",async()=>{
  const sql=mock.method(db,"query",async(text:string,params?:unknown[])=>{
    if(text.startsWith("CREATE"))return {rows:[]};
    assert.match(text,/user_id=\$1 AND agent_id=\$2 AND id=\$3 AND status='pending_review' AND expires_at>NOW\(\)/);
    assert.deepEqual(params,["user-1","agent-1","idea-1"]);return {rows:[]};
  });
  try{await assert.rejects(claimTradeIdea("user-1","agent-1","idea-1"),/expired or already handled/);}finally{sql.mock.restore();}
});
