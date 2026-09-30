const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const key = crypto.randomBytes(32).toString('hex');
function load(value) {
  const source = process.env.SECURITY_BASELINE_REF
    ? execFileSync('git',['show',`${process.env.SECURITY_BASELINE_REF}:backend/src/services/encryption.js`],{cwd:root,encoding:'utf8'})
    : fs.readFileSync(path.join(root,'src/services/encryption.js'),'utf8');
  const module = { exports: {} };
  vm.runInNewContext(source,{module,require,Buffer,process:{env:{ENCRYPTION_KEY:value}}});
  return module.exports;
}

test('missing, zero and malformed keys cannot encrypt or decrypt credentials',()=>{
  for(const value of [undefined,'','0'.repeat(64),'bad','f'.repeat(63),'g'.repeat(64)]){
    const service = load(value);
    assert.throws(()=>service.encrypt('isolated-api-key'));
    assert.throws(()=>service.decrypt('00:00'));
  }
});

test('new records use unique authenticated encryption and retain Unicode credentials',()=>{
  const service = load(key); const secret = 'isolated-token-🔐';
  const a=service.encrypt(secret),b=service.encrypt(secret);
  assert.match(a,/^v1:[a-f0-9]{24}:[a-f0-9]{32}:/);assert.notEqual(a,b);
  assert.equal(service.decrypt(a),secret);assert.equal(service.decrypt(b),secret);
  for(const index of [1,2,3]){
    const fields=a.split(':');fields[index]=(fields[index][0]==='0'?'1':'0')+fields[index].slice(1);
    assert.throws(()=>service.decrypt(fields.join(':')));
  }
  assert.throws(()=>load(crypto.randomBytes(32).toString('hex')).decrypt(a));
});

test('existing CBC credentials remain readable with the original configured key',()=>{
  const iv=crypto.randomBytes(16);const cipher=crypto.createCipheriv('aes-256-cbc',Buffer.from(key,'hex'),iv);
  const body=Buffer.concat([cipher.update('existing-api-key','utf8'),cipher.final()]);
  const record=iv.toString('hex')+':'+body.toString('hex');
  assert.equal(load(key).decrypt(record),'existing-api-key');
});

test('unknown formats, invalid lengths and malformed hex are rejected',()=>{
  const service=load(key);
  for(const value of [null,{},'v2:00:00:00','v1:00:00:00','v1:'+ '00'.repeat(12)+':'+ '00'.repeat(16)+':a', 'gg'.repeat(16)+':'+'00'.repeat(16)])assert.throws(()=>service.decrypt(value));
});
