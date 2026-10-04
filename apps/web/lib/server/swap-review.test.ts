import { test } from "node:test";
import assert from "node:assert/strict";
import { assertReviewCurrent, reviewedSwapMinimum } from "./swap-review";
test("a worsening quote cannot weaken the reviewed output minimum",()=>{
  assert.equal(reviewedSwapMinimum(101n,97n,"100"),100n);
  assert.equal(reviewedSwapMinimum(110n,107n,"100"),107n);
  assert.throws(()=>reviewedSwapMinimum(99n,95n,"100"),/below/);
});
test("raw minimum keeps full integer precision and rejects malformed terms",()=>{
  assert.equal(reviewedSwapMinimum(9007199254740993000n,1n,"9007199254740992999"),9007199254740992999n);
  for(const value of ["0","-1","1.5","1e18","", " 5"])assert.throws(()=>reviewedSwapMinimum(100n,95n,value));
});
test("expired and invalid review deadlines are rejected at the signing boundary",()=>{
  assert.doesNotThrow(()=>assertReviewCurrent(101,100));
  for(const deadline of [99,100,NaN,Infinity])assert.throws(()=>assertReviewCurrent(deadline,100));
});
