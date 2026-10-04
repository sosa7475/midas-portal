/**
 * GeckoTerminal (CoinGecko on-chain) — DEX/token analytics for ANY token by contract
 * across 250+ chains incl Base, Solana, Arbitrum. Free, no key. OHLCV candles included,
 * so this also powers tokenized-stock discovery + backtestable history.
 */
const BASE = "https://api.geckoterminal.com/api/v2";
const KEY = process.env.GECKOTERMINAL_API_KEY; // optional CoinGecko Pro key for higher limits

const NET: Record<string, string> = {
  eth: "eth", ethereum: "eth", base: "base", solana: "solana", sol: "solana",
  arbitrum: "arbitrum", arb: "arbitrum", polygon: "polygon_pos", matic: "polygon_pos",
  avalanche: "avax", avax: "avax", optimism: "optimism", op: "optimism", bsc: "bsc", bnb: "bsc",
  robinhood: "robinhood", hood: "robinhood", hoodchain: "robinhood", "hood-chain": "robinhood", rhc: "robinhood",
};
function net(n?: string): string { const k = (n || "eth").toLowerCase(); return NET[k] ?? k; }
const num = (v: unknown): number | null => { const n = Number(v); return Number.isFinite(n) ? n : null; };

async function gt(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`, {
    headers: { accept: "application/json", ...(KEY ? { "x-cg-pro-api-key": KEY } : {}) },
    signal: AbortSignal.timeout(12_000),
  });
  if (!r.ok) throw new Error(`GeckoTerminal ${r.status}`);
  return r.json();
}

export async function gtToken(network: string, address: string) {
  const a = (await gt(`/networks/${net(network)}/tokens/${address}`)).data.attributes;
  return { name: a.name, symbol: a.symbol, network: net(network), address: a.address,
    priceUsd: num(a.price_usd), fdvUsd: num(a.fdv_usd), marketCapUsd: num(a.market_cap_usd),
    volume24hUsd: num(a.volume_usd?.h24), totalLiquidityUsd: num(a.total_reserve_in_usd) };
}

export async function gtPools(network: string, address: string) {
  const d = (await gt(`/networks/${net(network)}/tokens/${address}/pools?page=1`)).data ?? [];
  return d.slice(0, 5).map((p: any) => ({
    name: p.attributes.name, dex: p.relationships?.dex?.data?.id, poolAddress: p.attributes.address,
    priceUsd: num(p.attributes.base_token_price_usd), liquidityUsd: num(p.attributes.reserve_in_usd),
    volume24hUsd: num(p.attributes.volume_usd?.h24), priceChange24hPct: num(p.attributes.price_change_percentage?.h24),
    buys24h: p.attributes.transactions?.h24?.buys ?? null, sells24h: p.attributes.transactions?.h24?.sells ?? null,
  }));
}

const OHLCV_TF: Record<string, [string, number]> = { "1d": ["day", 1], "4h": ["hour", 4], "1h": ["hour", 1], "15m": ["minute", 15], "5m": ["minute", 5] };
export async function gtOhlcv(network: string, pool: string, interval = "1d", limit = 100) {
  const [tf, agg] = OHLCV_TF[interval] ?? ["day", 1];
  const d = await gt(`/networks/${net(network)}/pools/${pool}/ohlcv/${tf}?aggregate=${agg}&limit=${Math.min(limit, 300)}`);
  const list: any[] = d.data?.attributes?.ohlcv_list ?? [];
  // GeckoTerminal returns newest-first; sort ascending so it's chronological (needed for backtests).
  return list.map((c) => ({ time: c[0] * 1000, open: +c[1], high: +c[2], low: +c[3], close: +c[4], volume: +c[5] })).sort((a, b) => a.time - b.time);
}

export async function gtSearch(query: string, network?: string, limit = 8) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Search limit must be a positive integer");
  const requestedNetwork = network ? net(network) : undefined;
  const d = (await gt(`/search/pools?query=${encodeURIComponent(query)}${requestedNetwork ? `&network=${encodeURIComponent(requestedNetwork)}` : ""}`)).data ?? [];
  return d.map((p: any) => {
    const relationshipNetwork = p.relationships?.network?.data?.id;
    const identifierNetwork = typeof p.id === "string" && p.id.includes("_") ? p.id.split("_")[0] : undefined;
    if (relationshipNetwork && identifierNetwork && relationshipNetwork !== identifierNetwork) return null;
    const poolNetwork = relationshipNetwork || identifierNetwork || null;
    if (requestedNetwork && poolNetwork !== requestedNetwork) return null;
    return { name: p.attributes.name, network: poolNetwork, poolAddress: p.attributes.address,
      priceUsd: num(p.attributes.base_token_price_usd), liquidityUsd: num(p.attributes.reserve_in_usd),
      volume24hUsd: num(p.attributes.volume_usd?.h24) };
  }).filter((p: any) => p !== null).slice(0, Math.min(limit, 8));
}

function mapPools(d: any[]) {
  return (d ?? []).slice(0, 12).map((p: any) => ({
    name: p.attributes.name, network: p.relationships?.network?.data?.id, dex: p.relationships?.dex?.data?.id, poolAddress: p.attributes.address,
    priceUsd: num(p.attributes.base_token_price_usd), liquidityUsd: num(p.attributes.reserve_in_usd),
    volume24hUsd: num(p.attributes.volume_usd?.h24), priceChange24hPct: num(p.attributes.price_change_percentage?.h24),
    createdAt: p.attributes.pool_created_at ?? null, buys24h: p.attributes.transactions?.h24?.buys ?? null, sells24h: p.attributes.transactions?.h24?.sells ?? null,
  }));
}
/** Freshly-launched pools on a chain — catch new tokens early. */
export async function gtNewPools(network: string) { return mapPools((await gt(`/networks/${net(network)}/new_pools?page=1`)).data); }
/** Highest liquidity/volume pools on a chain. */
export async function gtTopPools(network: string) { return mapPools((await gt(`/networks/${net(network)}/pools?page=1`)).data); }
/** Recent swaps in a pool — buy/sell flow. */
export async function gtTrades(network: string, pool: string) {
  const d = (await gt(`/networks/${net(network)}/pools/${pool}/trades`)).data ?? [];
  return d.slice(0, 40).map((t: any) => ({ time: t.attributes.block_timestamp, kind: t.attributes.kind, volumeUsd: num(t.attributes.volume_in_usd), priceUsd: num(t.attributes.price_to_in_usd ?? t.attributes.price_from_in_usd), tx: t.attributes.tx_hash }));
}
/** Token profile — description, socials, and GeckoTerminal trust score. */
export async function gtTokenInfo(network: string, address: string) {
  const a = (await gt(`/networks/${net(network)}/tokens/${address}/info`)).data.attributes;
  return { name: a.name, symbol: a.symbol, description: a.description, gtScore: num(a.gt_score), websites: a.websites, twitter: a.twitter_handle, telegram: a.telegram_handle, discord: a.discord_url, categories: a.categories, imageUrl: a.image_url };
}

export async function gtTrending(network?: string) {
  const path = network ? `/networks/${net(network)}/trending_pools` : `/networks/trending_pools`;
  const d = (await gt(path)).data ?? [];
  return d.slice(0, 8).map((p: any) => ({
    name: p.attributes.name, network: p.relationships?.network?.data?.id, poolAddress: p.attributes.address,
    volume24hUsd: num(p.attributes.volume_usd?.h24), priceChange24hPct: num(p.attributes.price_change_percentage?.h24),
  }));
}

/** Unified dispatcher for the chat tool. */
export async function dexAnalytics(a: { kind: string; network?: string; address?: string; pool?: string; query?: string; interval?: string; limit?: number }) {
  switch (a.kind) {
    case "token": if (!a.address) return { error: "address (contract) required" }; return gtToken(a.network || "eth", a.address);
    case "pools": if (!a.address) return { error: "address (contract) required" }; return { pools: await gtPools(a.network || "eth", a.address) };
    case "ohlcv": if (!a.pool) return { error: "pool address required (get it from kind=pools)" }; return { candles: await gtOhlcv(a.network || "eth", a.pool, a.interval || "1d", a.limit || 100) };
    case "search": if (!a.query) return { error: "query required" }; return { results: await gtSearch(a.query, a.network, a.limit ?? 8) };
    case "trending": return { trending: await gtTrending(a.network) };
    case "new_pools": return { newPools: await gtNewPools(a.network || "eth") };
    case "top_pools": return { topPools: await gtTopPools(a.network || "eth") };
    case "trades": if (!a.pool) return { error: "pool address required (get it from kind=pools)" }; return { trades: await gtTrades(a.network || "eth", a.pool) };
    case "token_info": if (!a.address) return { error: "address (contract) required" }; return gtTokenInfo(a.network || "eth", a.address);
    default: return { error: `unknown kind "${a.kind}". Valid: token, pools, ohlcv, search, trending, new_pools, top_pools, trades, token_info.` };
  }
}
