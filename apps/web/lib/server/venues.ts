import { createPublicClient, http, formatUnits, isAddress, type Address } from "viem";
import { CHAINS, getDecimals, tokenBalance } from "./dex";
import { loadKeysetPublic } from "./turnkey-sql";
import { getTradePerf } from "./strategy-sql";
import type { Scope } from "./execution-orders";

export function venueCapabilities() {
 return {venues:[
  ...["base","robinhood"].map(chain=>({id:chain,name:CHAINS[chain].name,chainId:CHAINS[chain].id,kind:"spot",quote:true,execution:"owner approval or scoped mandate",nativeGas:"ETH",tokenInput:"explicit contract; eth/weth aliases",connection:"Provision agent wallet in Wallet, then fund that address on this chain",automaticBridge:false,protectiveOrders:"owner-authorized off-chain monitor; not a guaranteed stop"})),
  {id:"hyperliquid",kind:"perpetuals",connection:"Connect an owner account with an approved API wallet",execution:"owner approval or scoped mandate"},
 ],observedAt:new Date().toISOString()};
}
export async function chainWallet(ctx:Scope,chain:string,extra:unknown=[]) {
 if(!["base","robinhood"].includes(chain))throw new Error("Supported wallet chains: base, robinhood");
 if(!Array.isArray(extra)||extra.length>20||extra.some(x=>typeof x!=="string"||!isAddress(x)))throw new Error("Provide at most 20 valid token addresses");
 const k=await loadKeysetPublic(ctx.userId,ctx.agentId);
 if(!k)return {connected:false,chain,nextAction:"Create an agent wallet in Wallet"};
 const c=CHAINS[chain],client=createPublicClient({transport:http(c.rpc)});
 if(await client.getChainId()!==c.id)throw new Error("RPC returned the wrong chain");
 const addresses=new Set<string>([c.wnative,...(c.usdc?[c.usdc]:[]),...extra].map(x=>x.toLowerCase()));
 const rows=await getTradePerf(ctx.userId,ctx.agentId,100);
 for(const r of rows)if(r.metrics?.chain===chain)for(const a of [r.metrics.tokenInAddr,r.metrics.tokenOutAddr])if(typeof a==="string"&&isAddress(a))addresses.add(a.toLowerCase());
 const native=await client.getBalance({address:k.evmAddress as Address});
 const tokens=await Promise.all([...addresses].slice(0,40).map(async address=>{
  try{const [decimals,balance]=await Promise.all([getDecimals(chain,address as Address),tokenBalance(chain,address as Address,k.evmAddress as Address)]);return {address,decimals,balance:formatUnits(balance,decimals),balanceRaw:balance.toString()};}
  catch{return {address,balance:null,error:"Token read unavailable"};}
 }));
 return {connected:true,chain,chainId:c.id,address:k.evmAddress,eth:formatUnits(native,18),tokens,valueUsd:null,inventoryComplete:false,observedAt:new Date().toISOString(),funding:"Deposit only on the selected chain. No bridge or transfer is automatic."};
}
