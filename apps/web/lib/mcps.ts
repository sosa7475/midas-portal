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
    ready: false,
    status: "Connect API key",
  },
  {
    id: "orderly",
    name: "Orderly",
    icon: "bolt",
    category: "Execution",
    description: "Perp execution + your live account: balance, positions, PnL, Sharpe, win rate.",
    ready: false,
    status: "Connect wallet",
  },
];

export const mcpById = (id: string) => MCPS.find((m) => m.id === id);
