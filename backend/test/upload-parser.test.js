const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const fs = require('node:fs');
const vm = require('node:vm');
const express = require('express');
const multer = require('multer');

function uploadHandler() {
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync('src/routes/strategy.js','utf8'),{module,process:{env:{MAX_FILE_SIZE:'32'}},require(name){
    if(name==='express')return express;if(name==='multer')return multer;if(name==='path')return require('node:path');
    if(name==='../middleware/auth')return {authenticate:(_req,_res,next)=>next()};
    if(name==='../db/client')return {query:()=>{throw new Error('No database calls permitted');}};
    if(name==='../agents/session-manager'||name==='../services/llm-adapter')return new Proxy({}, {get:()=>()=>{throw new Error('No model or trade calls permitted');}});
    throw new Error(name);
  }});
  return module.exports.stack.find(item=>item.route?.path==='/analyze-screenshot').route.stack[0].handle;
}
async function upload(name,data,complete=true){
  const boundary='isolated-upload-boundary';
  const buffer=Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="screenshot"; filename="${name}"\r\nContent-Type: image/png\r\n\r\n${data}\r\n${complete?'--'+boundary+'--\r\n':''}`);
  const req=Readable.from([buffer]);req.method='POST';req.headers={'content-type':`multipart/form-data; boundary=${boundary}`,'content-length':String(buffer.length)};
  const error=await new Promise(resolve=>uploadHandler()(req,{},resolve));return {req,error};
}
test('actual screenshot middleware preserves memory uploads and rejects oversized or malformed input',{timeout:3000},async()=>{
  const accepted=await upload('test.png','test-image');assert.equal(accepted.error,undefined);assert.equal(accepted.req.file.buffer.toString(),'test-image');
  const refused=await upload('test.exe','test-image');assert.equal(refused.req.file,undefined);
  const large=await upload('test.png','x'.repeat(64));assert.equal(large.error.code,'LIMIT_FILE_SIZE');
  const malformed=await upload('test.png','image',false);assert.ok(malformed.error);
});
test('Express extended query parser preserves nested fields and rejects prototype injection',()=>{
  const parser=require('express/lib/utils').compileQueryParser('extended');
  const parsed=parser('filter[category]=one&items[]=a&items[]=b&__proto__[polluted]=yes');
  assert.equal(parsed.filter.category,'one');assert.deepEqual(parsed.items,['a','b']);assert.equal({}.polluted,undefined);
});
