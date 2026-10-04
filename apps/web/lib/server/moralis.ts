import {gtToken} from "./geckoterminal";
/**
 * Moralis Money — on-chain wallet/token analytics. Activates when MORALIS_API_KEY
 * is set (add it in Vercel env). Until then the tool returns a clear "not connected".
 */
const key = () => process.env.MORALIS_API_KEY;
const BASE = "https://deep-index.moralis.io/api/v2.2";

async function m(path: string) {
  const r = await fetch(`${BASE}${path}`, {
    headers: { "X-API-Key": key() as string, accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`Moralis ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}

export function moralisReady(): boolean {
  return !!key();
}

// Well-known Ethereum-mainnet contracts so the agent can pass a symbol (e.g. "pepe")
// and still resolve to the right token instead of failing on an invalid address.
const KNOWN: Record<string, string> = {
  pepe: "0x6982508145454ce325ddbe47a25d4ec3d2311933",
  shib: "0x95ad61b0a150d79219dcf64e1e6cc01f0b64c4ce",
  link: "0x514910771af9ca656af840dff83e8264ecf986ca",
  uni: "0x1f9840a85d5af5bf1d1762f925bdaddc4201f984",
  wbtc: "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
  weth: "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
  usdc: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  usdt: "0xdac17f958d2ee523a2206206994597c13d831ec7",
  dai: "0x6b175474e89094c44da98b954eedeac495271d0f",
  arb: "0xb50721bcf8d664c30412cfbc6cf7a15145234ad1",
  mog: "0xaaee1a9723aadb7afa2810263653a34ba2c21c7a",
  floki: "0xcf0c122c6b73ff809c693db761e7baebe62b6a2e",
  ldo: "0x5a98fcbea516cf06857215779fd812ca3bef1b32",
  aave: "0x7fc66500c84a76ad7e9c93437bfc5ac33e2ddae9",
  ondo: "0xfaba6f8e4a5e8ab82f62fe7c39859fa577269be3",
};

const isAddr = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());

/** Turn a symbol or address into a checksummed-ish 0x contract, or null if unknown. */
function resolveToken(input: string): string | null {
  const s = (input || "").trim();
  if (isAddr(s)) return s;
  return KNOWN[s.toLowerCase().replace(/^\$/, "")] ?? null;
}

// Chain-name aliases → Moralis chain param. Robinhood Chain (4663) = 0x1237; Moralis may
// not index it yet, in which case token kinds return empty until they add support.
const CHAIN_ALIAS: Record<string, string> = { eth:"0x1",ethereum:"0x1",base:"0x2105",arbitrum:"0xa4b1",optimism:"0xa",polygon:"0x89",bsc:"0x38",avalanche:"0xa86a", robinhood: "0x1237", hood: "0x1237", hoodchain: "0x1237", "hood-chain": "0x1237" };
const resolveChain = (c: string) => CHAIN_ALIAS[(c || "").toLowerCase()] ?? c;

export async function onchain(kind: string, address: string, chainIn = "eth") {
  const allowed=["token_price","token_metadata","token_holders","token_analytics","wallet_tokens","wallet_networth"];
  if(!allowed.includes(kind))throw Error("Unsupported on-chain query kind");
  const chain = resolveChain(chainIn);

  // Wallet kinds take a wallet address as-is; token kinds resolve symbol → contract.
  const isWallet = kind === "wallet_tokens" || kind === "wallet_networth";
  let addr = address;
  if (!isWallet) {
    const resolved = isAddr(address)?address:["eth","ethereum","0x1"].includes(chainIn.toLowerCase())?resolveToken(address):null;
    if (!resolved) return { error: `Could not resolve "${address}" to a token contract. Pass the 0x contract address (or first call kind=token_metadata to look it up).` };
    addr = resolved;
  }

  if(!isAddr(addr))throw Error("Valid contract or wallet address required");
  if(kind==="token_price"){
   if(key())try{return {...await m(`/erc20/${addr}/price?chain=${chain}`),source:"moralis",observedAt:new Date().toISOString()};}catch{}
   try{const q=await gtToken(chainIn,addr);return {...q,usdPrice:q.priceUsd,source:"geckoterminal",observedAt:new Date().toISOString(),note:"DEX market price; not an executable quote."};}
   catch{return {available:false,source:null,error:"Token price unavailable from configured providers"};}
  }
  if(!key())return {connected:false,available:false,provider:"moralis",note:"Configure MORALIS_API_KEY for this query. Token-price queries can use the public DEX fallback."};
  if (kind === "token_metadata") return m(`/erc20/metadata?chain=${chain}&addresses=${addr}`);
  if (kind === "token_holders") return m(`/erc20/${addr}/holders?chain=${chain}&limit=20`);
  if (kind === "token_analytics") return m(`/tokens/${addr}/analytics?chain=${chain}`); // buy/sell/net volume, buyers/sellers by timeframe
  if (kind === "wallet_tokens") return m(`/wallets/${addr}/tokens?chain=${chain}`);
  if (kind === "wallet_networth") return m(`/wallets/${addr}/net-worth?chains=${chain}`);
  return { error: `unknown kind "${kind}". Valid: token_price, token_metadata, token_holders, token_analytics, wallet_tokens, wallet_networth.` };
}
