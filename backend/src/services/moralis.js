/**
 * Moralis Web3 API service — per-user encrypted API key.
 * Docs: https://docs.moralis.com/web3-data-api/evm
 *
 * Trading-agent surface area:
 *   - Token price + metadata (cross-chain)
 *   - Top holder distribution (concentration risk)
 *   - Wallet token holdings + PnL (smart money tracking)
 *   - Wallet swap history (entry/exit detection)
 *   - Token transfers (whale flow)
 *   - Trending / top gainers (Moralis Money endpoints; subject to plan)
 *
 * Chain handling: accept human names (eth, bsc, polygon, base, arbitrum, optimism, avalanche, solana)
 * and map to Moralis chain identifiers.
 */

const BASE = 'https://deep-index.moralis.io/api/v2.2';
const SOLANA_BASE = 'https://solana-gateway.moralis.io';

const CHAIN_MAP = {
  eth: '0x1', ethereum: '0x1', mainnet: '0x1',
  bsc: '0x38', bnb: '0x38',
  polygon: '0x89', matic: '0x89',
  base: '0x2105',
  arbitrum: '0xa4b1', arb: '0xa4b1',
  optimism: '0xa', op: '0xa',
  avalanche: '0xa86a', avax: '0xa86a',
  fantom: '0xfa', ftm: '0xfa',
  linea: '0xe708',
};

function resolveChain(chain) {
  const k = (chain || 'eth').toLowerCase();
  if (k === 'sol' || k === 'solana') return { kind: 'sol' };
  const id = CHAIN_MAP[k] || (k.startsWith('0x') ? k : null);
  if (!id) throw new Error(`Unsupported chain "${chain}"`);
  return { kind: 'evm', chain: id };
}

async function call(apiKey, path, { method = 'GET', query = null, body = null, baseOverride = null } = {}) {
  if (!apiKey) throw new Error('Moralis API key required (connect via /onchain/moralis/connect)');
  const url = new URL((baseOverride || BASE) + path);
  if (query) for (const [k, v] of Object.entries(query)) if (v != null) url.searchParams.set(k, String(v));
  const r = await fetch(url.toString(), {
    method,
    headers: {
      'accept': 'application/json',
      'X-API-Key': apiKey,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`Moralis ${r.status}: ${text.slice(0, 300)}`);
  try { return JSON.parse(text); } catch { return text; }
}

// ------------------------------ Token data -------------------------

async function getTokenPrice(apiKey, { chain, address }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') {
    const d = await call(apiKey, `/token/mainnet/${address}/price`, { baseOverride: SOLANA_BASE });
    return {
      chain: 'solana',
      address,
      priceUsd: d.usdPrice,
      nativePrice: d.nativePrice,
      exchange: d.exchangeName,
    };
  }
  const d = await call(apiKey, `/erc20/${address}/price`, { query: { chain: c.chain, include: '24hrPercentChange' } });
  return {
    chain,
    address,
    symbol: d.tokenSymbol,
    name: d.tokenName,
    priceUsd: d.usdPrice,
    nativePrice: d.nativePrice?.value,
    change24h: d['24hrPercentChange'] ? parseFloat(d['24hrPercentChange']) : null,
    exchange: d.exchangeName,
    pairAddress: d.pairAddress,
  };
}

async function getTokenMetadata(apiKey, { chain, address }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') {
    const d = await call(apiKey, `/token/mainnet/${address}/metadata`, { baseOverride: SOLANA_BASE });
    return { chain: 'solana', address, ...d };
  }
  const arr = await call(apiKey, '/erc20/metadata', { query: { chain: c.chain, addresses: address } });
  const m = Array.isArray(arr) ? arr[0] : arr;
  return {
    chain, address: m?.address,
    symbol: m?.symbol, name: m?.name, decimals: m?.decimals,
    totalSupplyFormatted: m?.total_supply_formatted,
    fullyDilutedValuation: m?.fully_diluted_valuation,
    marketCap: m?.market_cap,
    circulatingSupply: m?.circulating_supply,
    securityScore: m?.security_score,
    verified: m?.verified_contract,
    categories: m?.categories,
    links: m?.links,
  };
}

async function getTokenHolders(apiKey, { chain, address, limit = 25 }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') {
    const d = await call(apiKey, `/token/mainnet/holders/${address}`, { baseOverride: SOLANA_BASE, query: { limit } });
    return {
      chain: 'solana', address,
      totalHolders: d.totalHolders,
      top: (d.holders || d.result || []).slice(0, limit).map((h) => ({
        address: h.ownerAddress || h.address,
        balanceFormatted: h.balanceFormatted || h.balance,
        percentOfSupply: h.percentageRelativeToTotalSupply || h.percentage,
      })),
    };
  }
  // EVM: top holders via owners endpoint
  const d = await call(apiKey, `/erc20/${address}/owners`, { query: { chain: c.chain, limit, order: 'DESC' } });
  return {
    chain, address,
    top: (d.result || []).map((h) => ({
      address: h.owner_address,
      balanceFormatted: h.balance_formatted,
      percentOfSupply: h.percentage_relative_to_total_supply,
      isContract: h.is_contract,
    })),
    cursor: d.cursor,
  };
}

// ------------------------------ Wallet -----------------------------

async function getWalletTokens(apiKey, { address, chain }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') {
    const d = await call(apiKey, `/account/mainnet/${address}/tokens`, { baseOverride: SOLANA_BASE });
    return { chain: 'solana', address, tokens: d };
  }
  const d = await call(apiKey, `/wallets/${address}/tokens`, { query: { chain: c.chain } });
  return {
    chain, address,
    tokens: (d.result || []).map((t) => ({
      symbol: t.symbol, name: t.name,
      address: t.token_address,
      balanceFormatted: t.balance_formatted,
      usdValue: t.usd_value,
      priceUsd: t.usd_price,
      portfolioPct: t.portfolio_percentage,
      change24h: t.usd_price_24hr_percent_change,
      verified: t.verified_contract,
      possibleSpam: t.possible_spam,
    })),
  };
}

async function getWalletPnl(apiKey, { address, chain, days = 'all' }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') throw new Error('Solana wallet PnL via Moralis not supported here yet');
  const d = await call(apiKey, `/wallets/${address}/profitability/summary`, {
    query: { chain: c.chain, days },
  });
  return {
    chain, address, days,
    totalRealizedProfitUsd: d.total_realized_profit_usd,
    totalRealizedProfitPct: d.total_realized_profit_percentage,
    totalCountOfTrades: d.total_count_of_trades,
    totalSoldVolumeUsd: d.total_sold_volume_usd,
    totalBoughtVolumeUsd: d.total_bought_volume_usd,
  };
}

async function getWalletSwaps(apiKey, { address, chain, limit = 25 }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') throw new Error('Solana wallet swaps via Moralis not supported here yet');
  const d = await call(apiKey, `/wallets/${address}/swaps`, {
    query: { chain: c.chain, limit, order: 'DESC' },
  });
  return {
    chain, address,
    swaps: (d.result || []).map((s) => ({
      ts: s.block_timestamp,
      txHash: s.transaction_hash,
      type: s.transaction_type,
      pair: `${s.bought?.symbol || '?'}/${s.sold?.symbol || '?'}`,
      bought: { symbol: s.bought?.symbol, amountFormatted: s.bought?.amount, usd: s.bought?.usd_amount },
      sold: { symbol: s.sold?.symbol, amountFormatted: s.sold?.amount, usd: s.sold?.usd_amount },
      totalUsd: s.total_value_usd,
      exchange: s.exchange_name,
    })),
    cursor: d.cursor,
  };
}

async function getTokenTransfers(apiKey, { chain, address, limit = 25 }) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') throw new Error('Solana token transfers via Moralis not supported here yet');
  const d = await call(apiKey, `/erc20/${address}/transfers`, {
    query: { chain: c.chain, limit, order: 'DESC' },
  });
  return {
    chain, address,
    transfers: (d.result || []).map((t) => ({
      ts: t.block_timestamp,
      txHash: t.transaction_hash,
      from: t.from_address, to: t.to_address,
      valueFormatted: t.value_decimal,
      possibleSpam: t.possible_spam,
    })),
    cursor: d.cursor,
  };
}

// ------------------------ Discovery / "Money" ----------------------

async function getTopGainers(apiKey, { chain = 'eth', timeFrame = '1d', limit = 20, minMarketCap = 1_000_000 } = {}) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') throw new Error('Top gainers Solana endpoint differs; not wired yet');
  // Moralis Money discovery endpoint (subject to plan availability)
  const d = await call(apiKey, '/discovery/tokens/top-gainers', {
    query: { chain: c.chain, time_frame: timeFrame, min_market_cap: minMarketCap, limit },
  });
  const rows = d.result || d || [];
  return {
    chain, timeFrame,
    tokens: rows.slice(0, limit).map((t) => ({
      address: t.token_address || t.address,
      symbol: t.token_symbol || t.symbol,
      name: t.token_name || t.name,
      priceUsd: t.usd_price || t.price_usd,
      change: t.price_percent_change || t.change,
      marketCap: t.market_cap,
      volume24h: t.volume_usd,
    })),
  };
}

async function getTrendingTokens(apiKey, { chain = 'eth', limit = 20 } = {}) {
  const c = resolveChain(chain);
  if (c.kind === 'sol') throw new Error('Trending Solana endpoint differs; not wired yet');
  const d = await call(apiKey, '/tokens/trending', { query: { chain: c.chain, limit } });
  const rows = d.result || d || [];
  return {
    chain,
    tokens: rows.slice(0, limit).map((t) => ({
      address: t.token_address || t.address,
      symbol: t.token_symbol || t.symbol,
      name: t.token_name || t.name,
      priceUsd: t.usd_price,
      change24h: t.price_percent_change_24h || t.price_percent_change,
      marketCap: t.market_cap,
      volume24h: t.volume_usd,
    })),
  };
}

// Convenience: validate a key by hitting a cheap endpoint
async function ping(apiKey) {
  // /web3/version is auth-required and returns quickly
  const r = await fetch(`${BASE}/web3/version`, { headers: { 'X-API-Key': apiKey, accept: 'application/json' } });
  return r.ok;
}

module.exports = {
  getTokenPrice,
  getTokenMetadata,
  getTokenHolders,
  getWalletTokens,
  getWalletPnl,
  getWalletSwaps,
  getTokenTransfers,
  getTopGainers,
  getTrendingTokens,
  ping,
  resolveChain,
};
