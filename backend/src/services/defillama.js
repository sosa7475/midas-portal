/**
 * DefiLlama service — public REST wrappers for trading-relevant onchain data.
 * No auth required. Free public API: https://api.llama.fi
 *
 * Surface area chosen to feed the trading agent:
 *   - Protocol & chain TVL trends (risk-on/off proxy)
 *   - Token spot prices (cross-check perp marks)
 *   - DEX volumes (liquidity depth signal for alts)
 *   - Stablecoin supply flows (capital rotation signal)
 *   - Yield rates (parking idle collateral)
 *   - Perps DEX volumes & OI (alt-perp flow signal)
 *
 * All functions return small, agent-friendly objects (numbers + names),
 * not raw API payloads.
 */

const BASE = 'https://api.llama.fi';
const COINS = 'https://coins.llama.fi';
const STABLECOINS = 'https://stablecoins.llama.fi';
const YIELDS = 'https://yields.llama.fi';

async function get(url) {
  const r = await fetch(url, { headers: { 'accept': 'application/json' } });
  if (!r.ok) throw new Error(`DefiLlama ${r.status}: ${await r.text().catch(() => '')}`);
  return r.json();
}

// ------------------------------- TVL -------------------------------

async function getProtocolTvl(slug) {
  const d = await get(`${BASE}/protocol/${slug}`);
  const tvlSeries = d.tvl || [];
  const latest = tvlSeries[tvlSeries.length - 1];
  const dayAgo = tvlSeries[tvlSeries.length - 2];
  const weekAgo = tvlSeries[tvlSeries.length - 8];
  const monthAgo = tvlSeries[tvlSeries.length - 31];
  return {
    name: d.name,
    slug: d.slug,
    category: d.category,
    chains: d.chains,
    tvlUsd: latest?.totalLiquidityUSD || null,
    change24h: latest && dayAgo ? pct(latest.totalLiquidityUSD, dayAgo.totalLiquidityUSD) : null,
    change7d: latest && weekAgo ? pct(latest.totalLiquidityUSD, weekAgo.totalLiquidityUSD) : null,
    change30d: latest && monthAgo ? pct(latest.totalLiquidityUSD, monthAgo.totalLiquidityUSD) : null,
    description: d.description,
    url: d.url,
  };
}

async function getChainTvl(chain) {
  const all = await get(`${BASE}/v2/chains`);
  const c = all.find((x) => x.name.toLowerCase() === chain.toLowerCase() || x.gecko_id?.toLowerCase() === chain.toLowerCase());
  if (!c) throw new Error(`Chain "${chain}" not found`);
  const series = await get(`${BASE}/v2/historicalChainTvl/${encodeURIComponent(c.name)}`);
  const latest = series[series.length - 1];
  const dayAgo = series[series.length - 2];
  const weekAgo = series[series.length - 8];
  const monthAgo = series[series.length - 31];
  return {
    chain: c.name,
    tvlUsd: latest?.tvl || null,
    change24h: latest && dayAgo ? pct(latest.tvl, dayAgo.tvl) : null,
    change7d: latest && weekAgo ? pct(latest.tvl, weekAgo.tvl) : null,
    change30d: latest && monthAgo ? pct(latest.tvl, monthAgo.tvl) : null,
    tokenSymbol: c.tokenSymbol,
  };
}

async function getTopProtocols({ chain = null, category = null, limit = 20 } = {}) {
  const all = await get(`${BASE}/protocols`);
  let rows = all;
  if (chain) rows = rows.filter((p) => (p.chains || []).map((c) => c.toLowerCase()).includes(chain.toLowerCase()));
  if (category) rows = rows.filter((p) => (p.category || '').toLowerCase() === category.toLowerCase());
  rows.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  return rows.slice(0, limit).map((p) => ({
    name: p.name,
    slug: p.slug,
    category: p.category,
    chains: p.chains,
    tvlUsd: p.tvl,
    change24h: p.change_1d,
    change7d: p.change_7d,
  }));
}

// ------------------------------- Prices ----------------------------

/**
 * coins: array of { chain, address } OR ['coingecko:bitcoin', 'ethereum:0x...']
 * DefiLlama identifier format: `${chain}:${address}` or `coingecko:${id}`
 */
async function getTokenPrices(coins) {
  const ids = coins.map((c) => (typeof c === 'string' ? c : `${c.chain}:${c.address}`));
  const d = await get(`${COINS}/prices/current/${encodeURIComponent(ids.join(','))}`);
  return Object.entries(d.coins || {}).map(([id, v]) => ({
    id,
    symbol: v.symbol,
    priceUsd: v.price,
    decimals: v.decimals,
    timestamp: v.timestamp,
    confidence: v.confidence,
  }));
}

async function getTokenChart(coinId, period = '1d', span = 30) {
  // coinId e.g. "coingecko:bitcoin" or "ethereum:0x..."
  const d = await get(`${COINS}/chart/${encodeURIComponent(coinId)}?period=${period}&span=${span}`);
  const series = d.coins?.[coinId]?.prices || [];
  return {
    id: coinId,
    symbol: d.coins?.[coinId]?.symbol,
    period,
    points: series.map((p) => ({ ts: p.timestamp, price: p.price })),
  };
}

// ------------------------------ DEX volumes ------------------------

async function getDexVolume(chain) {
  const d = await get(`${BASE}/overview/dexs/${encodeURIComponent(chain)}?excludeTotalDataChartBreakdown=true`);
  return {
    chain,
    total24h: d.total24h,
    total7d: d.total7d,
    total30d: d.total30d,
    change24h: d.change_1d,
    change7d: d.change_7d,
    change30d: d.change_1m,
    topProtocols: (d.protocols || []).slice(0, 10).map((p) => ({
      name: p.name,
      total24h: p.total24h,
      change24h: p.change_1d,
    })),
  };
}

async function getPerpsVolume(chain = 'all') {
  // /overview/derivatives is now Pro-gated. Free path: filter /protocols by
  // category=Derivatives. Returns perp DEX *TVL* (capital deposited) + 1d/7d/30d
  // TVL change — a useful regime signal even though it isn't 24h volume.
  const all = await get(`${BASE}/protocols`);
  let perps = (all || []).filter((p) => (p.category || '').toLowerCase() === 'derivatives');
  if (chain && chain !== 'all') {
    perps = perps.filter((p) => (p.chains || []).map((c) => c.toLowerCase()).includes(chain.toLowerCase()));
  }
  perps.sort((a, b) => (b.tvl || 0) - (a.tvl || 0));
  const totalTvl = perps.reduce((s, p) => s + (p.tvl || 0), 0);
  const weighted = (key) => {
    const num = perps.reduce((s, p) => s + (p.tvl || 0) * (p[key] || 0), 0);
    return totalTvl > 0 ? num / totalTvl : null;
  };
  return {
    chain,
    metric: 'tvl', // distinguishes from volume; agent should be aware
    totalTvlUsd: totalTvl,
    change24h: weighted('change_1d'),
    change7d: weighted('change_7d'),
    change30d: weighted('change_1m'),
    topVenues: perps.slice(0, 15).map((p) => ({
      name: p.name,
      tvlUsd: p.tvl,
      change24h: p.change_1d,
      change7d: p.change_7d,
      chains: p.chains,
    })),
  };
}

// ------------------------------ Stablecoins ------------------------

async function getStablecoinFlows() {
  const d = await get(`${STABLECOINS}/stablecoins?includePrices=true`);
  const total = (d.peggedAssets || []).reduce((s, a) => s + (a.circulating?.peggedUSD || 0), 0);
  const top = (d.peggedAssets || [])
    .sort((a, b) => (b.circulating?.peggedUSD || 0) - (a.circulating?.peggedUSD || 0))
    .slice(0, 8)
    .map((a) => ({
      name: a.name,
      symbol: a.symbol,
      circulatingUsd: a.circulating?.peggedUSD,
      change1d: pct(a.circulating?.peggedUSD, a.circulatingPrevDay?.peggedUSD),
      change7d: pct(a.circulating?.peggedUSD, a.circulatingPrevWeek?.peggedUSD),
      change30d: pct(a.circulating?.peggedUSD, a.circulatingPrevMonth?.peggedUSD),
      pegType: a.pegType,
      chains: (a.chainCirculating ? Object.keys(a.chainCirculating) : []).slice(0, 5),
    }));
  return { totalUsd: total, top };
}

async function getStablecoinChainFlows(chain) {
  const d = await get(`${STABLECOINS}/stablecoinchains`);
  const c = (d || []).find((x) => x.name.toLowerCase() === chain.toLowerCase());
  if (!c) throw new Error(`Chain "${chain}" not in stablecoin index`);
  return {
    chain: c.name,
    totalCirculatingUsd: c.totalCirculatingUSD?.peggedUSD,
    change1d: pct(c.totalCirculatingUSD?.peggedUSD, c.totalCirculatingPrevDay?.peggedUSD),
    change7d: pct(c.totalCirculatingUSD?.peggedUSD, c.totalCirculatingPrevWeek?.peggedUSD),
    change30d: pct(c.totalCirculatingUSD?.peggedUSD, c.totalCirculatingPrevMonth?.peggedUSD),
  };
}

// ------------------------------ Yields -----------------------------

async function getTopYields({ chain = null, project = null, symbol = null, minTvl = 1_000_000, limit = 15 } = {}) {
  const d = await get(`${YIELDS}/pools`);
  let rows = d.data || [];
  if (chain) rows = rows.filter((p) => (p.chain || '').toLowerCase() === chain.toLowerCase());
  if (project) rows = rows.filter((p) => (p.project || '').toLowerCase().includes(project.toLowerCase()));
  if (symbol) rows = rows.filter((p) => (p.symbol || '').toLowerCase().includes(symbol.toLowerCase()));
  rows = rows.filter((p) => (p.tvlUsd || 0) >= minTvl);
  rows.sort((a, b) => (b.apy || 0) - (a.apy || 0));
  return rows.slice(0, limit).map((p) => ({
    project: p.project,
    chain: p.chain,
    symbol: p.symbol,
    apy: p.apy,
    apyBase: p.apyBase,
    apyReward: p.apyReward,
    tvlUsd: p.tvlUsd,
    pool: p.pool,
    stablecoin: p.stablecoin,
    ilRisk: p.ilRisk,
  }));
}

// ------------------------------ Helpers ----------------------------

function pct(curr, prev) {
  if (!curr || !prev) return null;
  return ((curr - prev) / prev) * 100;
}

module.exports = {
  getProtocolTvl,
  getChainTvl,
  getTopProtocols,
  getTokenPrices,
  getTokenChart,
  getDexVolume,
  getPerpsVolume,
  getStablecoinFlows,
  getStablecoinChainFlows,
  getTopYields,
};
