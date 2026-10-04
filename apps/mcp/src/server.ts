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
import { checkTrade } from "@midas/exchange";
import { getStrategy, setStrategy } from "./strategy-store.js";
import { loadTrading } from "./orderly-creds.js";

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
        "Midas provides live crypto perp market data, technical analysis, the user's trading " +
        "strategy, and live Orderly execution. Always call analyze_market before a trade opinion " +
        "so advice cites real numbers (price, RSI, ATR-based stops, funding). Check ideas against " +
        "get_strategy. Before place_trade, confirm the parameters with the user in plain language; " +
        "the risk engine may still block the order, and only report a trade as placed if the tool " +
        "returns placed:true.",
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

  // --- Account / execution (live Orderly via ed25519, risk + safety gated) ---
  // Credentials come from env (onboarding CLI). Reads work whenever creds exist.
  // Writes additionally require MIDAS_TRADING_ENABLED=true AND pass the risk engine;
  // MCP clients also prompt the user to approve each call (the human confirmation).

  const NOT_CONFIGURED = {
    enabled: false,
    reason:
      "Orderly trading not configured. Run onboarding (`pnpm --filter @midas/mcp onboard`), " +
      "set ORDERLY_ACCOUNT_ID / ORDERLY_KEY / ORDERLY_SECRET_HEX, and fund the account.",
  };

  server.registerTool(
    "get_account",
    {
      title: "Get account (balance & positions)",
      description: "Live Orderly balance, free collateral, holdings, and open positions.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const t = loadTrading();
      if (!t) return text(NOT_CONFIGURED);
      const [balance, positions] = await Promise.all([t.client.getBalance(), t.client.getPositions()]);
      return text({ network: t.network, balance, positions });
    }
  );

  server.registerTool(
    "get_open_orders",
    {
      title: "Get open orders",
      description: "Live open (incomplete) orders on Orderly.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async () => {
      const t = loadTrading();
      if (!t) return text(NOT_CONFIGURED);
      return text({ network: t.network, orders: await t.client.getOrders("INCOMPLETE") });
    }
  );

  server.registerTool(
    "place_trade",
    {
      title: "Place trade",
      description:
        "Place a perp order on Orderly. MARKET or LIMIT, optional stop-loss / take-profit " +
        "(attached as reduce-only bracket orders). Passes the server-side risk engine first " +
        "(max size/leverage/daily-loss/per-trade risk) and requires MIDAS_TRADING_ENABLED=true. " +
        "Your MCP client will also ask you to approve this call.",
      inputSchema: {
        symbol: z.string().describe("e.g. PERP_BTC_USDC or BTC"),
        side: z.enum(["long", "short"]),
        type: z.enum(["MARKET", "LIMIT"]).default("MARKET"),
        quantity: z.number().positive().describe("base-asset quantity"),
        price: z.number().positive().optional().describe("required for LIMIT"),
        stopLoss: z.number().positive().optional(),
        takeProfit: z.number().positive().optional(),
        reduceOnly: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async (o) => {
      const t = loadTrading();
      if (!t) return text(NOT_CONFIGURED);
      if (!t.enabled) {
        return text({
          placed: false,
          reason: "Trading is armed-off. Set MIDAS_TRADING_ENABLED=true to allow live orders.",
        });
      }
      const symbol = normalizeSymbol(o.symbol);

      // Price for risk math: LIMIT uses its price; MARKET uses live mark.
      const refPrice = o.price ?? (await getSnapshot(symbol)).markPrice ?? 0;
      const balance = await t.client.getBalance().catch(() => null);
      const equity = Number(balance?.total_collateral_value) || 0;
      const verdict = checkTrade(
        {
          notionalUsd: refPrice * o.quantity,
          leverage: equity > 0 ? (refPrice * o.quantity) / equity : Infinity,
          entry: refPrice,
          stopLoss: o.stopLoss,
          quantity: o.quantity,
        },
        { equityUsd: equity, realizedPnlTodayUsd: 0 },
        t.limits
      );
      if (!verdict.ok) {
        return text({ placed: false, blockedByRiskEngine: true, violations: verdict.violations });
      }

      const result = await t.client.placeOrder({
        symbol,
        side: o.side,
        type: o.type,
        quantity: o.quantity,
        price: o.price,
        reduceOnly: o.reduceOnly,
        stopLoss: o.stopLoss,
        takeProfit: o.takeProfit,
      });
      return text({ placed: true, network: t.network, order: result });
    }
  );

  server.registerTool(
    "cancel_order",
    {
      title: "Cancel order",
      description: "Cancel a specific open order by id + symbol.",
      inputSchema: { symbol: z.string(), orderId: z.number().int() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ symbol, orderId }) => {
      const t = loadTrading();
      if (!t) return text(NOT_CONFIGURED);
      if (!t.enabled) return text({ cancelled: false, reason: "Set MIDAS_TRADING_ENABLED=true." });
      return text({ cancelled: true, result: await t.client.cancelOrder(normalizeSymbol(symbol), orderId) });
    }
  );

  server.registerTool(
    "close_position",
    {
      title: "Close position",
      description: "Market-close the open position for a symbol (reduce-only).",
      inputSchema: { symbol: z.string() },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    async ({ symbol }) => {
      const t = loadTrading();
      if (!t) return text(NOT_CONFIGURED);
      if (!t.enabled) return text({ closed: false, reason: "Set MIDAS_TRADING_ENABLED=true." });
      return text({ closed: true, result: await t.client.closePosition(normalizeSymbol(symbol)) });
    }
  );

  return server;
}
