import {test} from "node:test";
import assert from "node:assert/strict";
import {compareV3Quotes} from "./swap-quotes";

test("selects best output rather than first successful fee tier",async()=>{
 const r=await compareV3Quotes(async fee=>({amountOut:fee===100?1010n:1000n,gasEstimate:100n}));
 assert.equal(r.best.fee,100);assert.equal(r.improvementRaw,10n);assert.equal(r.legacyFee,500);
});
test("cheapest fee need not deliver the best output",async()=>{
 const r=await compareV3Quotes(async fee=>({amountOut:fee===3000?1005n:1000n,gasEstimate:100n}));
 assert.equal(r.best.fee,3000);
});
test("unavailable pools are disclosed while valid quotes remain usable",async()=>{
 const r=await compareV3Quotes(async fee=>{if(fee!==100)throw new Error("no pool");return {amountOut:900n,gasEstimate:100n};});
 assert.equal(r.best.fee,100);assert.deepEqual(r.unavailableFeeTiers,[500,3000,10000]);
});
test("all failed or zero-output quotes stop routing",async()=>{
 await assert.rejects(compareV3Quotes(async()=>({amountOut:0n,gasEstimate:0n})),/No successful/);
});
test("ties prefer lower estimated gas and large token amounts retain precision",async()=>{
 const r=await compareV3Quotes(async fee=>({amountOut:10n**30n+(fee===100?1n:0n),gasEstimate:BigInt(fee)}));
 assert.equal(r.best.fee,100);assert.equal(r.improvementRaw,1n);
 const tie=await compareV3Quotes(async fee=>({amountOut:1000n,gasEstimate:BigInt(fee)}));
 assert.equal(tie.best.fee,100);
});
