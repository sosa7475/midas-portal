const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const id = '550e8400-e29b-41d4-a716-446655440000';
const secret = ' isolated-secret-with-exact-spaces-123456789 ';

function harness(key = secret, ttl) {
  const state = { user: { id, email:'one@example.invalid', password_hash:bcrypt.hashSync('existing-password',4) }, queries: [], down:false };
  function load(file) {
    const module={exports:{}};
    const source = process.env.SECURITY_BASELINE_REF && file !== 'services/session-token.js'
      ? require('node:child_process').execFileSync('git', ['show', `${process.env.SECURITY_BASELINE_REF}:backend/src/${file}`], { encoding: 'utf8' })
      : fs.readFileSync(path.join(__dirname,'../src',file),'utf8');
    vm.runInNewContext(source,{module,Buffer,process:{env:{JWT_SECRET:key,JWT_EXPIRES_IN:ttl}},console:{error(){}},require(name){
      if(name==='../services/session-token')return load('services/session-token.js');
      if(name==='../db/client')return {query:async(sql,params)=>{
        state.queries.push({sql,params});if(state.down)throw new Error('isolated outage');
        if(sql.startsWith('INSERT')) { state.user={id,email:params[0],password_hash:params[1],display_name:params[2]};return {rows:[state.user]}; }
        return {rows:state.user?[state.user]:[]};
      }};
      return require(name);
    }});return module.exports;
  }
  const response=()=>({statusCode:200,status(code){this.statusCode=code;return this;},json(body){this.body=body;return this;}});
  async function auth(token,scheme='Bearer'){
    const req={headers:token?{authorization:`${scheme} ${token}`}:{}};const res=response();let next=false;
    await load('middleware/auth.js').authenticate(req,res,()=>{next=true;});return {req,res,next};
  }
  async function post(url,body){
    const router=load('routes/auth.js');const layer=router.stack.find(item=>item.route?.path===url);const res=response();
    await layer.route.stack[0].handle({body},res);return res;
  }
  return {state,auth,post};
}

test('existing HS256 tokens keep working and use the current account identity',async()=>{
  const h=harness();const token=jwt.sign({userId:id,email:'old@example.invalid'},secret,{expiresIn:'7d'});
  const result=await h.auth(token);assert.equal(result.next,true);assert.equal(result.req.user.email,'one@example.invalid');
  assert.equal(h.state.queries[0].params[0],id);
});

test('deleted accounts, invalid claims, wrong algorithms and expired tokens are denied',async()=>{
  const h=harness();h.state.user=null;
  assert.equal((await h.auth(jwt.sign({userId:id},secret))).res.statusCode,401);
  h.state.queries=[];
  for(const token of [jwt.sign({userId:5},secret),jwt.sign({userId:'not-a-uuid'},secret),jwt.sign({userId:id},secret,{algorithm:'HS384'}),jwt.sign({userId:id},secret,{expiresIn:-1})])assert.equal((await h.auth(token)).res.statusCode,401);
  assert.equal(h.state.queries.length,0);
});

test('configuration and account lookup failures fail closed without calling protected handlers',async()=>{
  const token=jwt.sign({userId:id},secret);const h=harness('');
  const missing=await h.auth(token);assert.equal(missing.res.statusCode,503);assert.equal(missing.next,false);assert.equal(h.state.queries.length,0);
  const down=harness();down.state.down=true;const result=await down.auth(token);assert.equal(result.res.statusCode,503);assert.equal(result.next,false);
  assert.equal((await down.auth(token,'Basic')).res.statusCode,401);
});

test('login and registration preserve response shape, hashing and token compatibility',async()=>{
  const h=harness();const login=await h.post('/login',{email:'ONE@example.invalid',password:'existing-password'});
  assert.equal(login.statusCode,200);assert.equal(jwt.verify(login.body.token,secret).userId,id);assert.equal(login.body.user.id,id);
  h.state.user=null;
  const registered=await h.post('/register',{email:'new@example.invalid',password:'new-password',displayName:'New User'});
  assert.equal(registered.statusCode,201);assert.equal(registered.body.user.displayName,'New User');
  assert.equal(await bcrypt.compare('new-password',h.state.user.password_hash),true);
  assert.equal(jwt.verify(registered.body.token,secret).userId,id);
});

test('malformed inputs and missing signing configuration cannot write new accounts',async()=>{
  const h=harness();
  for(const url of ['/register','/login'])for(const body of [null,{}, {email:[],password:'pass'}, {email:'one@example.invalid',password:{}}])assert.equal((await h.post(url,body)).statusCode,400);
  assert.equal((await h.post('/register',{email:'one@example.invalid',password:'é'.repeat(37)})).statusCode,400);
  assert.equal(h.state.queries.length,0);
  const invalid=harness(secret,'invalid-duration');assert.equal((await invalid.post('/register',{email:'one@example.invalid',password:'test-password'})).statusCode,503);assert.equal(invalid.state.queries.length,0);
  const missing=harness('');assert.equal((await missing.post('/register',{email:'one@example.invalid',password:'test-password'})).statusCode,503);assert.equal(missing.state.queries.length,0);
});
