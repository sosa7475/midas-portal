/**
 * Hyperliquid client. Reads are unauthenticated (by address). Orders are signed
 * with a per-agent "agent wallet" key (trade-only). Testnet + mainnet.
 */
import * as hl from "@nktkas/hyperliquid";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {query} from "./db";

async function nextNonce(address:string) {
 const r=await query("INSERT INTO signer_nonces(signer,nonce) VALUES($1,$2) ON CONFLICT(signer) DO UPDATE SET nonce=GREATEST(signer_nonces.nonce+1,$2) RETURNING nonce",[address.toLowerCase(),Date.now()]);
 return Number(r.rows[0].nonce);
}
function exchange(privateKey:`0x${string}`,network:HlNetwork) {
 return new hl.ExchangeClient({transport:new hl.HttpTransport({isTestnet:network==="testnet"}),wallet:privateKeyToAccount(privateKey),nonceManager:nextNonce});
}

export const HL_BASES = { testnet: "https://api.hyperliquid-testnet.xyz", mainnet: "https://api.hyperliquid.xyz" };
export type HlNetwork = "testnet" | "mainnet";

async function info(network: HlNetwork, body: unknown): Promise<any> {
  const r = await fetch(`${HL_BASES[network]}/info`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
  if (!r.ok) throw new Error(`Hyperliquid /info ${r.status}`);
  return r.json();
}

export function generateAgentWallet() {
  const pk = generatePrivateKey();
  return { privateKey: pk, address: privateKeyToAccount(pk).address };
}

const metaCache: Record<string, Record<string, { a: number; szDecimals: number }>> = {};
async function meta(network: HlNetwork) {
  if (!metaCache[network]) {
    const m = await info(network, { type: "meta" });
    const map: Record<string, { a: number; szDecimals: number }> = {};
    (m.universe ?? []).forEach((u: any, i: number) => { map[u.name] = { a: i, szDecimals: u.szDecimals }; });
    metaCache[network] = map;
  }
  return metaCache[network];
}

export function hlSymbol(s: string): string {
  return s.trim().toUpperCase().replace(/^PERP_/, "").replace(/[-_/]?USD[CT]?$/i, "").replace(/[-_/]/g, "");
}

export async function getAccount(address: string, network: HlNetwork = "testnet") {
  const st = await info(network, { type: "clearinghouseState", user: address });
  const equity = Number(st?.marginSummary?.accountValue) || 0;
  const positions = (st?.assetPositions ?? [])
    .map((p: any) => ({ coin: p.position.coin, szi: Number(p.position.szi), entry: Number(p.position.entryPx) || null, upnl: Number(p.position.unrealizedPnl) || 0, value: Number(p.position.positionValue) || 0 }))
    .filter((p: any) => p.szi !== 0);
  return { equity, freeCollateral: Number.isFinite(Number(st?.withdrawable)) ? Number(st.withdrawable) : 0, positions, openPositions: positions.length };
}

/** Realized fills for an account — each closing fill carries closedPnl. Powers the live-trade ledger. */
export async function getUserFills(address: string, network: HlNetwork = "testnet") {
  const raw = await info(network, { type: "userFills", user: address });
  const fills = (Array.isArray(raw) ? raw : []).map((f: any) => ({
    coin: f.coin, dir: f.dir, sz: Number(f.sz) || 0, px: Number(f.px) || 0,
    closedPnl: Number(f.closedPnl) || 0, fee: Number(f.fee) || 0, oid: f.oid, time: f.time,
  }));
  const realizedPnl = Math.round(fills.reduce((a, f) => a + f.closedPnl - f.fee, 0) * 100) / 100;
  const wins = fills.filter((f) => f.closedPnl > 0).length;
  const closes = fills.filter((f) => /Close/i.test(f.dir || "")).length;
  return { realizedPnl, fillCount: fills.length, closes, winRatePct: closes ? Math.round((wins / closes) * 1000) / 10 : null, fills };
}

export async function markPrice(symbol: string, network: HlNetwork = "testnet"): Promise<number | null> {
  const mids = await info(network, { type: "allMids" });
  const v = Number(mids[hlSymbol(symbol)]);
  return Number.isFinite(v) ? v : null;
}

function fmtPx(px: number, szDecimals: number): string {
  const maxDec = Math.max(0, 6 - szDecimals);
  let p = Number(px.toPrecision(5));
  p = Number(p.toFixed(maxDec));
  return String(p);
}

export interface HlOrder { symbol: string; side: "long" | "short"; size: number; price?: number; reduceOnly?: boolean; clientOrderId?: string; slippagePct?: number; stopLoss?:number; takeProfit?:number }

export async function placeOrder(privateKey: `0x${string}`, o: HlOrder, network: HlNetwork = "testnet") {
  const coin = hlSymbol(o.symbol);
  const m = await meta(network);
  const asset = m[coin];
  if (!asset) throw new Error(`Unknown market ${coin} on Hyperliquid`);
  const mid = await markPrice(coin, network);
  if (!mid) throw new Error(`No price for ${coin}`);
  const isBuy = o.side === "long";
  const slip=o.slippagePct??0.5;
  if(!Number.isFinite(o.size)||o.size<=0||!Number.isFinite(slip)||slip<0||slip>3)throw new Error("Invalid order size or slippage");
  const size=Number(o.size.toFixed(asset.szDecimals));
  if(size<=0 || size!==o.size)throw new Error("Order size violates venue precision");
  const px = o.price ? Number(o.price) : mid * (1+(isBuy?1:-1)*slip/100); // aggressive for market-via-IOC
  const transport = new hl.HttpTransport({ isTestnet: network === "testnet" });
  const client = exchange(privateKey,network);
  const orders:any[]=[{ a: asset.a, b: isBuy, p: fmtPx(px, asset.szDecimals), s: String(size), r: !!o.reduceOnly, ...(o.clientOrderId?{c:o.clientOrderId}:{}), t:{limit:{tif:o.price?"Gtc":"Ioc"}} }];
  for(const [trigger,tpsl,index] of [[o.stopLoss,"sl",1],[o.takeProfit,"tp",2]] as const)if(trigger!==undefined) {
    if(!Number.isFinite(trigger)||trigger<=0 || (tpsl==="sl"?(isBuy?trigger>=mid:trigger<=mid):(isBuy?trigger<=mid:trigger>=mid)))throw Error("Invalid protective trigger");
    orders.push({a:asset.a,b:!isBuy,p:fmtPx(trigger*(isBuy?0.995:1.005),asset.szDecimals),s:String(size),r:true,t:{trigger:{isMarket:true,triggerPx:fmtPx(trigger,asset.szDecimals),tpsl}},...(o.clientOrderId?{c:`0x${(BigInt(o.clientOrderId)^BigInt(index)).toString(16).padStart(32,"0")}`}:{})});
  }
  return client.order({orders,grouping:orders.length>1?"normalTpsl":"na"});
}

export async function getOpenOrders(address:string,network:HlNetwork) {return info(network,{type:"frontendOpenOrders",user:address});}
export async function verifyApiWallet(owner:string,signer:string,network:HlNetwork) {
 if(owner.toLowerCase()===signer.toLowerCase())throw Error("Use an approved API wallet, not the account's owner key");
 const agents=await info(network,{type:"extraAgents",user:owner});
 if(!Array.isArray(agents)||!agents.some((a:any)=>a.address?.toLowerCase()===signer.toLowerCase()&&Number(a.validUntil)>Date.now()))throw Error("API wallet is not approved or its permission expired; approve it in Hyperliquid first");
}
export async function getOrder(address:string,oid:string|number,network:HlNetwork) {return info(network,{type:"orderStatus",user:address,oid});}
export async function cancelOrder(privateKey:`0x${string}`,symbol:string,oid:number,network:HlNetwork) {
 const asset=(await meta(network))[hlSymbol(symbol)];if(!asset)throw Error("Unknown market");
 return exchange(privateKey,network).cancel({cancels:[{a:asset.a,o:oid}]});
}
export async function protectPosition(privateKey:`0x${string}`,symbol:string,signedSize:number,stop:number,target:number|undefined,network:HlNetwork,cloid:string) {
 const asset=(await meta(network))[hlSymbol(symbol)];if(!asset)throw Error("Unknown market");
 const mid=await markPrice(symbol,network);if(!mid)throw Error("Market unavailable");
 const long=signedSize>0;
 if(!Number.isFinite(stop)||stop<=0||(long?stop>=mid:stop<=mid))throw Error("Stop must be on the protective side of the market");
 if(target!==undefined&&(!Number.isFinite(target)||target<=0||(long?target<=mid:target>=mid)))throw Error("Invalid target");
 const order=(px:number,tpsl:"sl"|"tp",index:number)=>({a:asset.a,b:!long,p:fmtPx(px*(long?0.995:1.005),asset.szDecimals),s:String(Math.abs(signedSize)),r:true,t:{trigger:{isMarket:true,triggerPx:fmtPx(px,asset.szDecimals),tpsl}},c:(index===0?cloid:`0x${(BigInt(cloid)^1n).toString(16).padStart(32,"0")}`) as `0x${string}`});
 return exchange(privateKey,network).order({orders:[order(stop,"sl",0),...(target?[order(target,"tp",1)]:[])],grouping:"positionTpsl"});
}
