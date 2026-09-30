const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const express = require('express');

function harness(key = crypto.randomBytes(32).toString('hex')) {
  const state = { rows: [], queries: [], balances: [] };
  function load(file) {
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src',file),'utf8'),{module,Buffer,process:{env:{ENCRYPTION_KEY:key}},console:{error(){}},require(name){
      if(name==='express') return express;
      if(name==='crypto') return crypto;
      if(name==='../services/encryption')return load('services/encryption.js');
      if(name==='../middleware/auth')return {authenticate:(_req,_res,next)=>next()};
      if(name==='../services/orderly')return {getBalance:async(apiKey,apiSecret)=>{state.balances.push({apiKey,apiSecret});return {balance:123};}};
      if(name==='../db/client')return {query:async(sql,params)=>{
        state.queries.push({sql,params});
        if(sql.startsWith('INSERT INTO api_keys'))state.rows.push({user_id:params[0],encrypted_key:params[1],encrypted_secret:params[2]});
        if(sql.startsWith('SELECT encrypted_key'))return {rows:state.rows.filter(row=>row.user_id===params[0])};
        return {rows:[]};
      }};
      throw new Error(name);
    }});return module.exports;
  }
  const wallet=load('routes/wallet.js');
  async function request(method,url,body={}) {
    const layer=wallet.stack.find(item=>item.route && item.route.methods[method.toLowerCase()] && item.match(url));assert.ok(layer);
    const res={statusCode:200,status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};
    await layer.route.stack[0].handle({body,user:{userId:'isolated-user'}},res);return res;
  }
  return {state,request};
}

test('wallet connection saves authenticated ciphertext and balance access decrypts the same credentials',async()=>{
  const h=harness();
  const response=await h.request('POST','/connect',{apiKey:'fake-key',apiSecret:'fake-secret'});
  assert.equal(response.statusCode,200);assert.equal(response.body.connected,true);
  assert.match(h.state.rows[0].encrypted_key,/^v1:/);assert.match(h.state.rows[0].encrypted_secret,/^v1:/);
  assert.ok(!JSON.stringify(response.body).includes('fake-secret'));
  assert.equal((await h.request('GET','/balance')).body.balance,123);
  assert.equal(h.state.balances[1].apiKey,'fake-key');assert.equal(h.state.balances[1].apiSecret,'fake-secret');
  assert.equal(h.state.queries.at(-1).params[0],'isolated-user');
});

test('missing encryption configuration cannot write credentials or call the wallet provider',async()=>{
  const h=harness('');assert.equal((await h.request('POST','/connect',{apiKey:'fake-key',apiSecret:'fake-secret'})).statusCode,500);
  assert.equal(h.state.queries.length,0);assert.equal(h.state.balances.length,0);
});
