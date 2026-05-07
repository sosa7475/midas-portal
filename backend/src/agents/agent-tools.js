/**
 * Agent tool registry.
 * Defines callable tools the LLM can invoke during chat to gather onchain
 * + Orderly market context for trade analysis and strategy building.
 *
 * Schema is provider-agnostic (Anthropic-shaped); llm-adapter translates
 * to OpenAI function-calling format.
 *
 * Each tool exports:
 *   - name, description, input_schema (JSONSchema-like)
 *   - run(input, ctx) → object  (ctx contains userId, decrypted moralisKey, etc.)
 */

const defillama = require('../services/defillama');
const moralis = require('../services/moralis');
const orderly = require('../services/orderly');

// ------------------------------------------------------------------
// DefiLlama (no auth)
// ------------------------------------------------------------------
const DEFILLAMA_TOOLS = [
  {
    name: 'defillama_protocol_tvl',
    description: 'Get TVL and 24h/7d/30d change for a DeFi protocol by slug (e.g. "uniswap", "aave-v3", "lido"). Use to gauge protocol health and capital flows.',
    input_schema: {
      type: 'object',
      properties: { slug: { type: 'string', description: 'DefiLlama protocol slug' } },
      required: ['slug'],
    },
    run: ({ slug }) => defillama.getProtocolTvl(slug),
  },
  {
    name: 'defillama_chain_tvl',
    description: 'Get total TVL for a chain (Ethereum, Solana, Base, Arbitrum, etc.) with 24h/7d/30d change. Risk-on/off proxy.',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string', description: 'Chain name e.g. Ethereum, Solana, Base' } },
      required: ['chain'],
    },
    run: ({ chain }) => defillama.getChainTvl(chain),
  },
  {
    name: 'defillama_top_protocols',
    description: 'List top protocols by TVL, optionally filtered by chain or category (Dexes, Lending, Liquid Staking, Yield, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        category: { type: 'string' },
        limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      },
    },
    run: (args) => defillama.getTopProtocols(args || {}),
  },
  {
    name: 'defillama_token_prices',
    description: 'Get spot USD prices for one or more tokens. Each token id is "chain:address" (e.g. "ethereum:0xa0b86991...") or "coingecko:bitcoin".',
    input_schema: {
      type: 'object',
      properties: {
        coins: { type: 'array', items: { type: 'string' }, description: 'Array of token ids' },
      },
      required: ['coins'],
    },
    run: ({ coins }) => defillama.getTokenPrices(coins),
  },
  {
    name: 'defillama_dex_volume',
    description: 'Get 24h/7d/30d DEX volume for a chain plus top DEX protocols. Liquidity depth + alt-rotation signal.',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string', description: 'Chain name e.g. Ethereum, Solana, Base' } },
      required: ['chain'],
    },
    run: ({ chain }) => defillama.getDexVolume(chain),
  },
  {
    name: 'defillama_perps_volume',
    description: 'Perp DEX TVL ranks (capital deposited per venue: Jupiter, Hyperliquid, GMX, dYdX, etc.) plus TVL-weighted 1d/7d/30d change. Pass chain="all" for global or specific chain (e.g. Arbitrum, Solana). Useful to spot perp regime shifts. NOTE: returns TVL not 24h volume (volume endpoint is paid).',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string', default: 'all' } },
    },
    run: ({ chain = 'all' } = {}) => defillama.getPerpsVolume(chain),
  },
  {
    name: 'defillama_stablecoin_flows',
    description: 'Total stablecoin supply + 1d/7d/30d net mint/burn for top stables (USDT, USDC, DAI, etc.). Net mints = capital entering crypto = risk-on signal.',
    input_schema: { type: 'object', properties: {} },
    run: () => defillama.getStablecoinFlows(),
  },
  {
    name: 'defillama_stablecoin_chain_flows',
    description: 'Stablecoin circulating supply on a single chain with 1d/7d/30d change. Capital rotation signal between L1s.',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string' } },
      required: ['chain'],
    },
    run: ({ chain }) => defillama.getStablecoinChainFlows(chain),
  },
  {
    name: 'defillama_top_yields',
    description: 'Top stablecoin / token yields. Filter by chain, project, symbol, min TVL. Use to park idle collateral or evaluate strategy yield assumptions.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        project: { type: 'string' },
        symbol: { type: 'string' },
        minTvl: { type: 'number', default: 1000000 },
        limit: { type: 'integer', default: 15 },
      },
    },
    run: (args) => defillama.getTopYields(args || {}),
  },
];

// ------------------------------------------------------------------
// Moralis (per-user encrypted key, supplied via ctx.moralisKey)
// ------------------------------------------------------------------
function requireMoralis(ctx) {
  if (!ctx.moralisKey) {
    throw new Error('Moralis API key not connected. User must add one via Settings → Onchain Data.');
  }
  return ctx.moralisKey;
}

const MORALIS_TOOLS = [
  {
    name: 'moralis_token_price',
    description: 'Spot price + 24h change for an ERC20/SPL token by chain + address. Chains: eth, bsc, polygon, base, arbitrum, optimism, avalanche, solana.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' },
        address: { type: 'string', description: 'Contract / mint address' },
      },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getTokenPrice(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_token_metadata',
    description: 'Token metadata: supply, market cap, FDV, security score, verification status, links. Use for fundamental sanity-check before trading low-cap.',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string' }, address: { type: 'string' } },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getTokenMetadata(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_token_holders',
    description: 'Top token holders with balances and percent of supply. Concentration risk check (high % in few wallets = exit-liquidity risk).',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' }, address: { type: 'string' },
        limit: { type: 'integer', default: 25, maximum: 100 },
      },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getTokenHolders(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_wallet_tokens',
    description: 'All token holdings for a wallet with USD values + 24h price change + portfolio % breakdown. Smart-money tracking primitive.',
    input_schema: {
      type: 'object',
      properties: { chain: { type: 'string' }, address: { type: 'string' } },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getWalletTokens(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_wallet_pnl',
    description: 'Wallet realized PnL summary over a window (days). Identify profitable wallets to mirror.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' }, address: { type: 'string' },
        days: { type: 'string', enum: ['7', '30', '60', '90', 'all'], default: 'all' },
      },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getWalletPnl(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_wallet_swaps',
    description: 'Recent DEX swaps by a wallet with bought/sold tokens, USD values, exchange. Detect entries/exits in real time.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' }, address: { type: 'string' },
        limit: { type: 'integer', default: 25 },
      },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getWalletSwaps(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_token_transfers',
    description: 'Recent transfers of an ERC20 token. Spot whale moves before a trade.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string' }, address: { type: 'string' },
        limit: { type: 'integer', default: 25 },
      },
      required: ['chain', 'address'],
    },
    run: (input, ctx) => moralis.getTokenTransfers(requireMoralis(ctx), input),
  },
  {
    name: 'moralis_top_gainers',
    description: 'Top gaining tokens on a chain over a timeframe. Discovery tool for momentum trades. Subject to Moralis plan.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string', default: 'eth' },
        timeFrame: { type: 'string', enum: ['1h', '4h', '12h', '1d', '1w'], default: '1d' },
        minMarketCap: { type: 'number', default: 1000000 },
        limit: { type: 'integer', default: 20 },
      },
    },
    run: (input, ctx) => moralis.getTopGainers(requireMoralis(ctx), input || {}),
  },
  {
    name: 'moralis_trending',
    description: 'Trending tokens on a chain by activity. Discovery tool for narrative shifts. Subject to Moralis plan.',
    input_schema: {
      type: 'object',
      properties: {
        chain: { type: 'string', default: 'eth' },
        limit: { type: 'integer', default: 20 },
      },
    },
    run: (input, ctx) => moralis.getTrendingTokens(requireMoralis(ctx), input || {}),
  },
];

// ------------------------------------------------------------------
// Orderly market data (no auth required for public endpoints)
// ------------------------------------------------------------------
const ORDERLY_TOOLS = [
  {
    name: 'orderly_ticker',
    description: 'Get current Orderly perp ticker (mark price, index price, 24h vol, funding) for a perp pair like "PERP_BTC_USDC" or "PERP_SOL_USDC".',
    input_schema: {
      type: 'object',
      properties: { pair: { type: 'string' } },
      required: ['pair'],
    },
    run: ({ pair }) => orderly.getTicker(pair),
  },
  {
    name: 'orderly_market_info',
    description: 'Orderly market metadata: tick size, lot size, min notional, leverage cap. Use before sizing trades.',
    input_schema: {
      type: 'object',
      properties: { pair: { type: 'string' } },
      required: ['pair'],
    },
    run: ({ pair }) => orderly.getMarketInfo(pair),
  },
];

// ------------------------------------------------------------------
const ALL_TOOLS = [...DEFILLAMA_TOOLS, ...MORALIS_TOOLS, ...ORDERLY_TOOLS];
const TOOL_BY_NAME = Object.fromEntries(ALL_TOOLS.map((t) => [t.name, t]));

function getToolSchemas() {
  return ALL_TOOLS.map(({ name, description, input_schema }) => ({ name, description, input_schema }));
}

async function runTool(name, input, ctx) {
  const tool = TOOL_BY_NAME[name];
  if (!tool) throw new Error(`Unknown tool: ${name}`);
  return tool.run(input || {}, ctx || {});
}

module.exports = { getToolSchemas, runTool, ALL_TOOLS };
