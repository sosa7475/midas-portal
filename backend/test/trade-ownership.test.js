const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const strategyId = '550e8400-e29b-41d4-a716-446655440000';
function harness(owned = true) {
  const state = { orders: [], credentials: [], queries: [] };
  const module = { exports: {} };
  let source=fs.readFileSync('src/routes/trade.js','utf8');
  if(process.env.SECURITY_BASELINE_REF)source=require('node:child_process').execFileSync('git',['show',`${process.env.SECURITY_BASELINE_REF}:backend/src/routes/trade.js`],{encoding:'utf8'});
  vm.runInNewContext(source,{module,console:{error(){}},require(name){
    if(name==='express')return express;
    if(name==='../services/trade-status')return require('../src/services/trade-status');
    if(name==='../services/trade-input')return require('../src/services/trade-input');
    if(name==='../middleware/auth')return {authenticate:(_req,_res,next)=>next()};
    if(name==='./wallet')return {getUserOrderlyCreds:async user=>{state.credentials.push(user);return {apiKey:'fake-key',apiSecret:'fake-secret'};}};
    if(name==='../services/orderly')return {placeOrder:async order=>{state.orders.push(order);return {orderId:'fake-order',status:'submitted'};}};
    if(name==='../db/client')return {query:async(sql,params)=>{state.queries.push({sql,params});if(sql.startsWith('SELECT id FROM strategies')){assert.match(sql,/user_id = \$2/);assert.equal(params[1],'acting-user');return {rows:owned?[{id:strategyId}]:[]};}return {rows:[{id:'fake-trade'}]};}};
    throw new Error(name);
  }});
  async function request(method,url,body={}){
    const layer=module.exports.stack.find(item=>item.route?.path===url && item.route.methods[method]);
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}};
    await layer.route.stack[0].handle({body,user:{userId:'acting-user'},query:{}},res);return res;
  }
  return {state,request};
}
const order={pair:'PERP_BTC_USDC',side:'long',size:0.01};
test('foreign or missing strategies are refused before credential lookup or order placement',async()=>{
  const h=harness(false);assert.equal((await h.request('post','/confirm',{...order,strategyId})).statusCode,404);
  assert.equal(h.state.credentials.length,0);assert.equal(h.state.orders.length,0);
});
test('owned strategies and unlinked orders retain the normal execution and journal response',async()=>{
  const h=harness();for(const body of [order,{...order,strategyId}]){const res=await h.request('post','/confirm',body);assert.equal(res.statusCode,200);assert.equal(res.body.execution.orderId,'fake-order');}
  assert.equal(h.state.queries.filter(q=>q.sql.includes('INSERT INTO trades')).every(q=>q.params[9]==='pending'),true);
  assert.equal(h.state.orders.length,2);assert.equal(h.state.orders[0].size,0.01);assert.equal(h.state.orders[0].apiKey,'fake-key');
});
test('malformed strategy IDs are rejected and historical joins cannot expose another user strategy name',async()=>{
  const h=harness();assert.equal((await h.request('post','/confirm',{...order,strategyId:{id:'bad'}})).statusCode,400);assert.equal(h.state.orders.length,0);
  await h.request('get','/history');assert.match(h.state.queries.at(-1).sql,/s\.user_id = t\.user_id/);
});

test('invalid order input cannot access credentials, place orders or write the journal', async () => {
  const invalid = [null, [], 'order',
    ...['1abc', -1, 0, true, {}, [], 'Infinity', Infinity, NaN, '0x10', '1e12', '1e-9'].map(size => ({...order, size})),
    ...['buy', 'LONG', 'unknown', null, {}].map(side => ({...order, side})),
    {...order, pair: 'PERP_BTC_USDC/other'}, {...order, pair: {}},
    {...order, orderType: 'UNKNOWN'}, {...order, orderType: 'LIMIT'},
    {...order, entry: 'bad'}, {...order, stopLoss: -2}, {...order, takeProfit: true},
    {...order, screenshotUrl: {}}, {...order, agentReasoning: []}];
  for (const body of invalid) {
    const h = harness();
    assert.equal((await h.request('post', '/confirm', body)).statusCode, 400);
    assert.equal(h.state.credentials.length, 0);
    assert.equal(h.state.orders.length, 0);
    assert.equal(h.state.queries.length, 0);
  }
});
test('mobile market orders and explicit limit orders use identical normalized values in the order and journal', async () => {
  for (const body of [
    {...order, entry: 65000, stopLoss: 64000, takeProfit: 68000},
    {...order, side: 'short', orderType: 'LIMIT', size: '1e-3', entry: '65000.25', stopLoss: '68000', takeProfit: '64000'},
    {...order, size: 0.00000001, entry: null, stopLoss: '', takeProfit: null},
  ]) {
    const h = harness();
    assert.equal((await h.request('post', '/confirm', body)).statusCode, 200);
    const sent = h.state.orders[0];
    const journal = h.state.queries.find(q => q.sql.includes('INSERT INTO trades')).params;
    assert.equal(sent.size, Number(body.size));
    assert.deepEqual(Array.from(journal.slice(4, 8)), [sent.size, sent.price, sent.stopLoss, sent.takeProfit]);
    assert.equal(sent.side, body.side);
    assert.equal(sent.orderType, body.orderType || 'MARKET');
  }
});
