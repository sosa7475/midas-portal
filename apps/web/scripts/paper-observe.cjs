#!/usr/bin/env node
// Local-only quote observation. This command never submits trades or creates intents.
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
require.extensions['.ts']=(module,filename)=>module._compile(ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,filename);
const {createPublicClient,http}=require('viem');
const {quoteSwap,CHAINS}=require('../lib/server/dex.ts');
const {recordPaperObservation}=require('../lib/server/paper-journal.ts');
const {digest}=require('../lib/server/paper-trading.ts');
const [configPath,journalPath,capturePath]=process.argv.slice(2);
if(!configPath||!journalPath||!capturePath)throw new Error('Usage: node scripts/paper-observe.cjs CONFIG JOURNAL CAPTURE');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
if(config.researchApproved!==false)throw new Error('This observer requires entries disabled; it does not generate trading signals.');
(async()=>{
 const startedAt=Date.now();
 const capture={startedAt,mode:'observation-only',venue:'Base Uniswap v3',hypotheticalUsdc:config.maxPositionUsd,limitations:['No strategy qualified; no paper order requested.','Hypothetical USDC balance is not the connected wallet balance.','Gas estimate excludes L1 data fees, approvals and router overhead; incomplete costs prevent paper fills.']};
 let quote;
 try{
  const q=await quoteSwap('base',CHAINS.base.usdc,CHAINS.base.wnative,String(config.maxPositionUsd),6,18);
  const client=createPublicClient({transport:http(CHAINS.base.rpc)});
  const [gasPrice,block]=await Promise.all([client.getGasPrice(),client.getBlock({blockNumber:BigInt(q.blockNumber)})]);
  const observedAt=Date.now();const ethUsd=config.maxPositionUsd/Number(q.amountOut);
  quote={side:'buy',observedAt,blockNumber:q.blockNumber,blockTime:Number(block.timestamp)*1000,amountIn:config.maxPositionUsd,amountOut:Number(q.amountOut),gasUsd:Number(q.gasEstimate)*Number(gasPrice)/1e18*ethUsd,costsComplete:false};
  const {amountIn,amountOutRaw,...details}=q;capture.quote=details;capture.gasPriceWei=gasPrice.toString();capture.blockTime=quote.blockTime;capture.blockAgeMs=observedAt-quote.blockTime;
 }catch(error){capture.quoteError=error.message;}
 capture.completedAt=Date.now();
 fs.mkdirSync(path.dirname(path.resolve(capturePath)),{recursive:true});
 // A capture cannot overwrite a previous observation.
 fs.writeFileSync(capturePath,JSON.stringify(capture,null,2),{flag:'wx',mode:0o600});
 const observation={id:digest(capture),observedAt:capture.completedAt,signalKnownAt:startedAt,signal:'hold',quote,evidenceDigest:digest(capture)};
 const result=recordPaperObservation(journalPath,config,observation);
 console.log(JSON.stringify({sequence:result.sequence,action:result.decision.action,reason:result.decision.reason,paperCashUsd:result.decision.state.cashUsd,paperTrades:result.decision.state.trades,quoteAvailable:!!quote,blockAgeMs:capture.blockAgeMs,costsComplete:quote?.costsComplete??false}));
})().catch(error=>{console.error(error.message);process.exitCode=1});
