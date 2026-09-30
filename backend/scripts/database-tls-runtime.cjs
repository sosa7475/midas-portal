const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),pg=require('pg'),net=require('node:net'),tls=require('node:tls'),path=require('node:path'),os=require('node:os'),{execFileSync}=require('node:child_process');
const {databaseConfig}=require('../src/db/config');

test('actual PostgreSQL client rejects untrusted and wrong-host certificates before login',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pg-tls-fixture-'));let server;const sockets=new Set();let loginBytes=0;
 try{
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=wrong-host.invalid','-days','1'],{stdio:'ignore'});
  const context=tls.createSecureContext({key:fs.readFileSync(key),cert:fs.readFileSync(cert)});
  server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.once('data',data=>{assert.equal(data.readInt32BE(4),80877103);socket.write('S');const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:context});sockets.add(secure);secure.on('error',()=>{});secure.once('close',()=>sockets.delete(secure));secure.on('data',data=>{loginBytes+=data.length;});});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  for(const trusted of [false,true]){
   const url=new URL(`postgresql://fixture:fixture@127.0.0.1:${server.address().port}/fixture?sslmode=no-verify`);if(trusted)url.searchParams.set('sslrootcert',cert);
   const client=new pg.Client({...databaseConfig({DATABASE_URL:url.href,NODE_ENV:'production'}),connectionTimeoutMillis:3000});
   try{await assert.rejects(client.connect(),error=>trusted?error.code==='ERR_TLS_CERT_ALTNAME_INVALID':error.code==='DEPTH_ZERO_SELF_SIGNED_CERT');}finally{await client.end();}
  }
  assert.equal(loginBytes,0);
 }finally{sockets.forEach(s=>s.destroy());if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
test('actual PostgreSQL client accepts a trusted certificate with the matching address',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pg-tls-valid-'));let server,client;const sockets=new Set();let startup=false;
 try{
  const key=path.join(dir,'key.pem'),cert=path.join(dir,'cert.pem');execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',key,'-out',cert,'-subj','/CN=127.0.0.1','-addext','subjectAltName=IP:127.0.0.1','-days','1'],{stdio:'ignore'});
  const context=tls.createSecureContext({key:fs.readFileSync(key),cert:fs.readFileSync(cert)});
  server=net.createServer(socket=>{sockets.add(socket);socket.on('error',()=>{});socket.once('close',()=>sockets.delete(socket));socket.once('data',()=>{socket.write('S');const secure=new tls.TLSSocket(socket,{isServer:true,secureContext:context});sockets.add(secure);secure.on('error',()=>{});secure.once('close',()=>sockets.delete(secure));secure.once('data',data=>{startup=true;assert.equal(data.readInt32BE(4),196608);secure.write(Buffer.from([82,0,0,0,8,0,0,0,0,90,0,0,0,5,73]));});});});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=new URL(`postgresql://fixture:fixture@127.0.0.1:${server.address().port}/fixture`);url.searchParams.set('sslrootcert',cert);
  client=new pg.Client({...databaseConfig({DATABASE_URL:url.href,NODE_ENV:'production'}),connectionTimeoutMillis:3000});await client.connect();assert.equal(startup,true);
 }finally{if(client)await client.end();sockets.forEach(s=>s.destroy());if(server)await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
