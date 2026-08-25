/**
 * Midas MCP server — exposes market analysis, strategy, and (guarded) trading
 * tools to any MCP client (Claude Desktop/Code locally via stdio; claude.ai or
 * hosted agents via Streamable HTTP). The connected agent is the trading brain;
 * Midas provides live data and (Phase 3) execution.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  getCandles,
  getSnapshot,
  normalizeSymbol,
  summarize,
} from "@midas/analysis";
import { getStrategy, setStrategy } from "./strategy-store.js";

const READ_ONLY = { readOnlyHint: true, openWorldHint: true } as const;

function text(obj: unknown) {
  return {
    content: [{ type: "text" as const, text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }],
  };
}

export function createServer(): McpServer {
  const server = new McpServer(
    { name: "midas-portal", version: "0.1.0" },
    {
      instructions:
        "Midas provides live crypto perp market data, technical analysis, and the user's " +
        "trading strategy. Use analyze_market before giving any trade opinion so your advice " +
        "cites real numbers (price, RSI, ATR-based stops, funding). Check ideas against " +
        "get_strategy. Never claim a trade was placed — execution is not yet enabled.",
    }
  );

  // --- Market data + analysis (no credentials required) ---

  server.registerTool(
    "analyze_market",
    {
      title: "Analyze market",
      description:
        "Full technical snapshot for a symbol: live mark/index price, 24h stats, funding, " +
        "open interest, plus computed indicators (RSI, EMA20/50, SMA200, MACD, ATR, VWAP, " +
        "Bollinger) and swing support/resistance. Use this before any trade opinion.",
      inputSchema: {
        symbol: z.string().describe("e.g. BTC, ETH, or PERP_BTC_USDC"),
        interval: z
          .enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"])
          .default("1h")
          .describe("candle interval for indicators"),
      },
      annotations: READ_ONLY,
    },
    async ({ symbol, interval }) => {
      const [snapshot, candles] = await Promise.all([
        getSnapshot(symbol),
        getCandles(symbol, interval, 250),
      ]);
      const indicators = summarize(candles);
      return text({
        symbol: normalizeSymbol(symbol),
        interval,
        snapshot,
        indicators,
        candleCount: candles.length,
        note: "ATR14 is useful for stop distance; funding sign shows crowd positioning.",
      });
    }
  );

  server.registerTool(
    "get_market_snapshot",
    {
      title: "Get market snapshot",
      description:
        "Live price/funding snapshot only (no indicators): mark, index, last, 24h high/low/change, " +
        "open interest, funding rate and next funding time.",
      inputSchema: { symbol: z.string().describe("e.g. BTC, ETH, PERP_SOL_USDC") },
      annotations: READ_ONLY,
    },
    async ({ symbol }) => text(await getSnapshot(symbol))
  );

  server.registerTool(
    "get_candles",
    {
      title: "Get candles (OHLCV)",
      description: "Raw OHLCV candles for charting or custom analysis. Returns up to `limit` most-recent bars.",
      inputSchema: {
        symbol: z.string(),
        interval: z.enum(["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"]).default("1h"),
        limit: z.number().int().min(1).max(500).default(100),
      },
      annotations: READ_ONLY,
    },
    async ({ symbol, interval, limit }) => {
      const candles = await getCandles(symbol, interval, limit);
      return text({ symbol: normalizeSymbol(symbol), interval, count: candles.length, candles });
    }
  );

  // --- Strategy (local persistence) ---

  server.registerTool(
    "get_strategy",
    {
      title: "Get trading strategy",
      description: "Returns the user's saved trading strategy (rules the agent should enforce on every idea).",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const s = await getStrategy();
      return text(s ?? { note: "No strategy defined yet. Use set_strategy to save one." });
    }
  );

  server.registerTool(
    "set_strategy",
    {
      title: "Set trading strategy",
      description: "Save/replace the user's trading strategy in plain English (entry/exit rules, risk, filters).",
      inputSchema: {
        rulesText: z.string().min(10).describe("the strategy in plain English"),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    },
    async ({ rulesText, name }) => text(await setStrategy(rulesText, name))
  );

  // --- Account / execution (guarded — Phase 3) ---
  // Deliberately NOT wired to live order placement. Orderly private endpoints need
  // ed25519 signing (Phase 3) and an explicit human-confirmation flow before any
  // real order fires. These return a clear "not enabled" result so the agent never
  // claims a trade happened.

  server.registerTool(
    "get_account",
    {
      title: "Get account (balance & positions)",
      description:
        "Live balance and open positions. NOT YET ENABLED — requires Orderly ed25519 account " +
        "auth (Phase 3). Returns an explanatory status until then.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () =>
      text({
        enabled: false,
        reason:
          "Live account access requires Orderly ed25519 signing + account registration (Phase 3). " +
          "Analysis and strategy tools work now; balance/positions will light up after Phase 3.",
      })
  );

  server.registerTool(
    "place_trade",
    {
      title: "Place trade",
      description:
        "Place a perp order (pair, side, size, entry, SL, TP). NOT YET ENABLED — execution is " +
        "gated behind Orderly ed25519 auth, a server-side risk engine, and explicit user " +
        "confirmation (Phase 3). This tool will never place an order in its current state.",
      inputSchema: {
        pair: z.string(),
        side: z.enum(["long", "short"]),
        size: z.number().positive(),
        entry: z.number().positive().optional(),
        stopLoss: z.number().positive().optional(),
        takeProfit: z.number().positive().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (order) =>
      text({
        placed: false,
        enabled: false,
        reason:
          "Trade execution is not enabled yet (Phase 3: Orderly ed25519 auth + risk engine + " +
          "confirmation flow). Nothing was sent to any exchange.",
        wouldHaveSubmitted: order,
      })
  );

  return server;
}
