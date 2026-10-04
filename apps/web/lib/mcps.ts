/** Connectable trading MCPs. Each agent chooses which to enable. */
export interface McpDef {
  id: string;
  name: string;
  icon: string;
  category: string;
  description: string;
  /** true = works now with no setup */
  ready: boolean;
  status: string;
}

export const MCPS: McpDef[] = [
  {
    id: "technical-analysis",
    name: "Technical Analysis",
    icon: "chart",
    category: "Market",
    description: "Live price, RSI, EMA, MACD, ATR, funding & open interest from Orderly market data.",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "defillama",
    name: "DeFiLlama",
    icon: "layers",
    category: "DeFi",
    description: "Protocol TVL, yields/APYs, stablecoin flows, and chain-level DeFi metrics.",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "moralis",
    name: "Moralis Money",
    icon: "link",
    category: "On-chain",
    description: "Wallet & token analytics, holder concentration, smart-money flows, transfers.",
    ready: true,
    status: "Live · on-chain data",
  },
  {
    id: "opensea",
    name: "OpenSea",
    icon: "nft",
    category: "NFT",
    description: "NFT collections, floor prices, trending, wallet holdings & marketplace analysis via OpenSea.",
    ready: true,
    status: "Live · NFT data",
  },
  {
    id: "geckoterminal",
    name: "GeckoTerminal",
    icon: "candles",
    category: "On-chain",
    description: "DEX analytics for any token by contract on 250+ chains (Base, Solana…): price, liquidity, pools, OHLCV candles, and tokenized-stock discovery.",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "security",
    name: "Token Security",
    icon: "shield",
    category: "Security",
    description: "Smart-contract risk analysis (GoPlus): honeypot, buy/sell tax, mint authority, ownership, pausable/blacklist, LP lock & holder concentration.",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "robinhood",
    name: "Robinhood Chain",
    icon: "feather",
    category: "Tokenized Stocks",
    description: "Robinhood's new L2 (chain 4663): 194 tokenized US stocks & ETFs — live prices, daily volume, trading halts, contracts, and corporate actions (dividends, splits).",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "ostium",
    name: "Ostium",
    icon: "scale",
    category: "Derivatives",
    description: "On-chain RWA & equity perps — live prices for stocks (HOOD, NVDA, TSLA), commodities, FX, and indices, with market-open status.",
    ready: true,
    status: "Live · no key needed",
  },
  {
    id: "equities",
    name: "Equities (Finnhub)",
    icon: "building",
    category: "Equities",
    description: "Real underlying US stock data — live quote, company profile, and fundamentals. Value tokenized stocks vs. the real share.",
    ready: false,
    status: "Add FINNHUB_API_KEY",
  },
  {
    id: "orderly",
    name: "Hyperliquid",
    icon: "bolt",
    category: "Execution",
    description: "Perp execution + your live account: equity, positions, and unrealized PnL.",
    ready: false,
    status: "Set up in Wallet",
  },
];

export const mcpById = (id: string) => MCPS.find((m) => m.id === id);
