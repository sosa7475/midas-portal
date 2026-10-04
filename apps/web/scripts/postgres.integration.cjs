const {test}=require('node:test');const assert=require('node:assert/strict');const {Pool}=require('pg');const {randomUUID}=require('node:crypto');const fs=require('node:fs');const path=require('node:path');
test('PostgreSQL migration, real concurrent execution and OAuth replay isolation',{skip:!process.env.MIDAS_TEST_DATABASE_URL},async()=>{
 const url=new URL(process.env.MIDAS_TEST_DATABASE_URL);
 if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!='/midas_test')throw Error('Integration tests require an isolated local midas_test database');
 const schema='midas_test_'+randomUUID().replaceAll('-','');
 const admin=new Pool({connectionString:url.toString()});await admin.query(`CREATE SCHEMA ${schema}`);
 const pool=new Pool({connectionString:url.toString(),options:`-c search_path=${schema}`,max:8});global._midasPool=pool;
 try{
  await pool.query('CREATE TABLE agents(id UUID PRIMARY KEY,user_id UUID NOT NULL);');
  for(const file of ['0004_execution_control.sql','0005_operations.sql'])await pool.query(fs.readFileSync(path.join(__dirname,'../../../db/migrations',file),'utf8'));
  const ctx={userId:randomUUID(),agentId:randomUUID()};await pool.query('INSERT INTO agents VALUES($1,$2)',[ctx.agentId,ctx.userId]);
  const {createExecution,approveExecution,executeOnce}=require('../lib/server/execution-orders.ts');
  const order=await createExecution(ctx,'swap','evm:test:account',{t:'swap'});await approveExecution(ctx,order.id);
  let dispatched=0;const send=async()=>{dispatched++;await new Promise(r=>setTimeout(r,100));return {placed:true,status:'filled'};};
  const result=await Promise.all([executeOnce(ctx,order.id,'swap',send),executeOnce(ctx,order.id,'swap',send)]);
  assert.equal(dispatched,1);assert.equal(result.filter(r=>r.duplicate).length,1);
  await assert.rejects(executeOnce({...ctx,userId:randomUUID()},order.id,'swap',send),/not found/);
  const orders=await Promise.all([createExecution(ctx,'swap','evm:test:other',{t:'swap'}),createExecution(ctx,'swap','evm:test:other',{t:'swap'})]);
  for(const o of orders)await approveExecution(ctx,o.id);
  let sideEffects=0;const uncertain=async()=>{sideEffects++;await pool.query("INSERT INTO execution_events(order_id,kind,data) VALUES($1,'venue_submission','{}')",[orders[0].id]);throw Error('Timeout after send');};
  await assert.rejects(executeOnce(ctx,orders[0].id,'swap',uncertain),/Timeout/);
  await assert.rejects(executeOnce(ctx,orders[1].id,'swap',send),/unique/);assert.equal(sideEffects,1);
  // A confirmed buy and its actual-sized exit are committed together and survive replay.
  await pool.query("INSERT INTO worker_health(name) VALUES('execution-monitor')");
  const payload={t:'swap',chain:'base',account:'0x1111111111111111111111111111111111111111',tokenIn:'0x4200000000000000000000000000000000000006',tokenOut:'0x2222222222222222222222222222222222222222',amountInHuman:'0.1',decimalsIn:18,decimalsOut:18,slippagePct:1,gasReserveEth:'0.001',maxGasEth:'0.001',exitPlan:{stopLossPct:10,takeProfitPct:20,maxHoldingSeconds:3600}};
  const entry=await createExecution(ctx,'swap','evm:test:protected',payload);await approveExecution(ctx,entry.id);
  const filled=await executeOnce(ctx,entry.id,'swap',async()=>({status:'filled',amountOutRaw:'1234567890123456789'}));
  assert.equal(filled.status,'filled');
  const exit=(await pool.query('SELECT * FROM spot_exit_rules WHERE entry_order_id=$1',[entry.id])).rows[0];
  assert.equal(exit.amount_raw,'1234567890123456789');assert.equal(exit.stop_out_raw,'90000000000000000');assert.equal(exit.target_out_raw,'120000000000000000');
  assert.equal(exit.expires_at-exit.exit_at,300000);
  assert.equal((await executeOnce(ctx,entry.id,'swap',send)).duplicate,true);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM spot_exit_rules')).rows[0].n,1);
  const broken=await createExecution(ctx,'swap','evm:test:incomplete-receipt',payload);await approveExecution(ctx,broken.id);
  await assert.rejects(executeOnce(ctx,broken.id,'swap',async()=>{
   await pool.query("INSERT INTO execution_events(order_id,kind,data) VALUES($1,'transaction','{}')",[broken.id]);
   return {status:'filled'};
  }),/verified output/);
  const failed=(await pool.query('SELECT status,result FROM execution_orders WHERE id=$1',[broken.id])).rows[0];
  assert.equal(failed.status,'unknown');assert.equal(failed.result,null);
  await pool.query("UPDATE worker_health SET heartbeat_at=NOW()-INTERVAL '5 minutes'");
  const stale=await createExecution(ctx,'swap','evm:test:stale',payload);await approveExecution(ctx,stale.id);
  await assert.rejects(executeOnce(ctx,stale.id,'swap',send),/monitor unavailable/);
  process.env.JWT_SECRET='isolated-integration-secret'.repeat(3);
  const {signToken,getSession,revokeSession}=require('../lib/server/auth.ts');
  const sessionToken=await signToken({userId:ctx.userId,email:'isolated@test.invalid'});
  const request={cookies:{get:()=>({value:sessionToken})},headers:{get:()=>null}};
  assert.equal((await getSession(request)).userId,ctx.userId);
  await revokeSession(request);assert.equal(await getSession(request),null);
  const {issueCode,exchangeGrant,hashChallenge}=require('../lib/server/oauth-grants.ts');
  const verifier='v'.repeat(48);const code=await issueCode({...ctx,client_id:'test',redirect_uri:'https://test.invalid/callback',cc:hashChallenge(verifier),scopes:['read']});
  const tokens=await exchangeGrant({grant_type:'authorization_code',client_id:'test',redirect_uri:'https://test.invalid/callback',code_verifier:verifier,code});
  const next=await exchangeGrant({grant_type:'refresh_token',client_id:'test',refresh_token:tokens.refresh_token});
  await assert.rejects(exchangeGrant({grant_type:'refresh_token',client_id:'test',refresh_token:tokens.refresh_token}),/invalid_grant/);
  await assert.rejects(exchangeGrant({grant_type:'refresh_token',client_id:'test',refresh_token:next.refresh_token}),/invalid_grant/);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM mcp_tokens')).rows[0].n,0);
 }finally{await pool.end();await admin.query(`DROP SCHEMA ${schema} CASCADE`);await admin.end();delete global._midasPool;}
});
