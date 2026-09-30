const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),pg=require('pg');
const {databaseConfig}=require('../src/db/config');

test('actual pg configuration requires certificate and hostname verification for production URLs',()=>{
 for(const query of ['', '?sslmode=disable','?sslmode=no-verify','?sslmode=require&uselibpqcompat=true','?sslmode=verify-ca&uselibpqcompat=true','?ssl=0','?ssl=no-verify']){
  const config=databaseConfig({DATABASE_URL:'postgresql://fixture:p%40ss@database.invalid:5433/fixture'+query,NODE_ENV:'production',PGSSLMODE:'disable'});
  const params=new pg.Client(config).connectionParameters;
  assert.ok(params.ssl,query);assert.notEqual(params.ssl.rejectUnauthorized,false,query);assert.equal(typeof params.ssl.checkServerIdentity,'function',query);assert.equal(params.host,'database.invalid');assert.equal(params.port,5433);assert.equal(params.password,'p@ss');assert.equal(params.database,'fixture');
 }
});
test('local development can use plaintext while requested TLS is fully verified',()=>{
 const base={DATABASE_URL:'postgresql://fixture:fixture@127.0.0.1/fixture',NODE_ENV:'development'};
 assert.equal(new pg.Client(databaseConfig(base)).connectionParameters.ssl,false);
 for(const mode of ['require','verify-ca','no-verify','prefer']){const params=new pg.Client(databaseConfig({...base,PGSSLMODE:mode})).connectionParameters;assert.ok(params.ssl);assert.notEqual(params.ssl.rejectUnauthorized,false);assert.equal(typeof params.ssl.checkServerIdentity,'function');}
 assert.throws(()=>databaseConfig({DATABASE_URL:'invalid-secret'}),/Invalid DATABASE_URL$/);
});
test('custom certificate paths and unrelated connection parameters survive normalization',()=>{
 const dir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'database-ca-'));
 try {const cert=require('node:path').join(dir,'ca.pem');fs.writeFileSync(cert,'fixture certificate');const url=new URL('postgresql://fixture:fixture@db.invalid/fixture?application_name=fixture-app');url.searchParams.set('sslrootcert',cert);const params=new pg.Client(databaseConfig({DATABASE_URL:url.href,NODE_ENV:'production'})).connectionParameters;assert.equal(params.ssl.ca,'fixture certificate');assert.equal(params.application_name,'fixture-app');assert.notEqual(params.ssl.rejectUnauthorized,false);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('shared database client retains pool limits, query parameters and release-on-failure behavior',async()=>{
 const module={exports:{}},calls=[],logs=[];let options,handler,fail=false,releases=0;
 vm.runInNewContext(fs.readFileSync(require('node:path').join(__dirname,'../src/db/client.js'),'utf8'),{module,process:{env:{DATABASE_URL:'postgresql://fixture:fixture@db.invalid/fixture?sslmode=no-verify',NODE_ENV:'production'}},console:{error:(...args)=>logs.push(args)},require:name=>{
  if(name==='./config')return {databaseConfig};assert.equal(name,'pg');return {Pool:class{constructor(config){options=config;}on(event,fn){assert.equal(event,'error');handler=fn;}async connect(){return {query:async(sql,values)=>{calls.push({sql,values});if(fail)throw Error('private-query-error');return {rows:[{id:1}]};},release:()=>releases++};}}};
 }});
 assert.equal(options.max,10);assert.equal(options.idleTimeoutMillis,30000);assert.equal(options.ssl.rejectUnauthorized,true);
 const values=['fixture'];assert.equal((await module.exports.query('SELECT $1',values)).rows[0].id,1);assert.equal(calls[0].values,values);assert.equal(releases,1);
 fail=true;await assert.rejects(module.exports.query('SELECT $1',values),/private-query-error/);assert.equal(releases,2);handler(Error('private-connection-error'));assert.equal(JSON.stringify(logs),'[["Database pool error"]]');
});
