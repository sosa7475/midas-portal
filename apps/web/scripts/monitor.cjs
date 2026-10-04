// Independent loops prevent a slow receipt/provider or alert endpoint from delaying exits.
const {deliverAlerts}=require('../lib/server/alert-delivery.ts');
const {monitorExits}=require('../lib/server/spot-exits.ts');
const {reconcileOrders}=require('../lib/server/reconcile.ts');
const {heartbeat}=require('../lib/server/operations.ts');
let stopped=false;process.on('SIGTERM',()=>stopped=true);process.on('SIGINT',()=>stopped=true);
async function loop(name,work,interval){
 do{
  try{
   const result=await work();
   await heartbeat(name,{lastSuccessAt:new Date().toISOString()});
   console.log(JSON.stringify({monitor:name,result}));
  }catch(e){console.error(`${name} failed:`,e.message);}
  if(process.argv.includes('--once'))break;
  if(!stopped)await new Promise(r=>setTimeout(r,interval));
 }while(!stopped);
}
Promise.all([
 loop('execution-monitor',monitorExits,10000),
 loop('reconciliation-monitor',reconcileOrders,15000),
 loop('alert-delivery',deliverAlerts,10000),
]).then(()=>require('../lib/server/db.ts').pool.end()).catch(()=>process.exitCode=1);
