// Keep risk monitoring in a separate process from potentially slow model calls.
const {fork}=require('node:child_process');
const path=require('node:path');
const monitor=process.argv.includes('--research-only')?null:fork(path.join(__dirname,'monitor.cjs'),process.argv.includes('--once')?['--once']:[],{execArgv:['--require',path.join(__dirname,'register-typescript.cjs')],stdio:'inherit'});
monitor?.on('exit',(code)=>{if(!stopped&&!process.argv.includes('--once')){console.error('Execution monitor exited');process.exitCode=code||1;stopped=true;}});
const {workerTick}=require('../lib/server/agent-worker.ts');
let stopped=false;
process.on('SIGTERM',()=>{stopped=true;monitor?.kill('SIGTERM');});process.on('SIGINT',()=>{stopped=true;monitor?.kill('SIGTERM');});
(async()=>{do {try{const r=await workerTick();console.log(JSON.stringify(r));}catch(e){console.error('Worker tick failed:',e.message);}
 if(process.argv.includes('--once'))break;
 if(!stopped)await new Promise(resolve=>setTimeout(resolve,15000));
}while(!stopped);await require('../lib/server/db.ts').pool.end();})().catch(()=>{process.exitCode=1;});
