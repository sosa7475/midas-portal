import { callTool as sharedTool } from "../../../lib/server/mcp-tools";
import { NextRequest } from "next/server";
import { swapOutput } from "../../../lib/swap-output";
import OpenAI from "openai";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { ensureAgentsTable, loadAgentMessages, saveAgentMessage } from "../../../lib/server/agents-sql";
import { getCandles, getSnapshot, normalizeSymbol, summarize } from "../../../lib/server/market";
import { defiData, defiRiskOnSeries, macroFactors } from "../../../lib/server/defi";
import { onchain, moralisReady } from "../../../lib/server/moralis";
import { openseaSearch, openseaCollection, openseaTrending, openseaWallet, openseaReady } from "../../../lib/server/opensea";
import { fetchHistory, fetchHistoryOnchain, runBacktest } from "../../../lib/server/backtest";
import { dexAnalytics } from "../../../lib/server/geckoterminal";
import { hoodChain } from "../../../lib/server/robinhood";
import { ostiumQuote, ostiumMarkets } from "../../../lib/server/ostium";
import { equityData, equitiesReady } from "../../../lib/server/equities";
import { tokenSecurity } from "../../../lib/server/security";
import { getActiveStrategy, getAutoPromote, addVersion, logPerf, getPerf } from "../../../lib/server/strategy-sql";
import { backtestSpec, judge, validSpec } from "../../../lib/server/strategy-review";
import { getAccount as hlGetAccount, markPrice as hlMarkPrice, getUserFills as hlUserFills } from "../../../lib/server/hyperliquid";
import { loadHlPublic } from "../../../lib/server/hl-sql";
import { loadKeysetPublic, loadKeysetSigner } from "../../../lib/server/turnkey-sql";
import { nativeBalance, tokenBalance, CHAINS, resolveToken, getDecimals, quoteSwap, executeSwap } from "../../../lib/server/dex";
import { agentSignEvmTx } from "../../../lib/server/turnkey";
import { getRisk, enforceGuardrails } from "../../../lib/server/agent-risk-sql";
import { checkOrder } from "../../../lib/server/risk";

export const runtime = "nodejs";
export const maxDuration = 120;

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

function fnTool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return { type: "function", function: { name, description, parameters } };
}

// Reusable schema for the backtest condition DSL.
const OP = { type: "string", enum: [">", "<", ">=", "<=", "cross_above", "cross_below"] };
const OPERAND = {
  type: "object",
  properties: {
    ind: { type: "string", enum: ["close", "open", "high", "low", "volume", "ema", "sma", "rsi", "atr", "roc", "macd_line", "macd_signal", "macd_hist", "bb_upper", "bb_mid", "bb_lower", "donchian_high", "donchian_low", "defi_tvl", "defi_tvl_roc30", "stablecoin_mcap", "stablecoin_roc30"] },
    period: { type: "number" }, mult: { type: "number" }, value: { type: "number" },
  },
};

// One entry per MCP: how to describe it to the agent + the tools it unlocks.
const MCP_REGISTRY: Record<string, { capability: string; tools: Tool[] }> = {
  "technical-analysis": {
    capability: "Technical Analysis (tools: analyze_market, backtest_strategy) — live indicators PLUS a robust multi-year backtester. When asked to backtest, translate YOUR OWN strategy (from your creator instructions) faithfully into entry/exit CONDITIONS and run it. Report Sharpe, max drawdown, win rate, CAGR, profit factor. Be honest about overfitting.",
    tools: [
      fnTool("analyze_market", "Live market snapshot + indicators (RSI, EMA, MACD, ATR, funding, OI) for a perp symbol like BTC, ETH, SOL.", { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] } }, required: ["symbol"] }),
      fnTool("backtest_strategy", "Backtest a strategy over years of real history using an expressive condition engine. Express the strategy as entry/exit CONDITIONS. An OPERAND is {ind, period, mult} or {value}. ind ∈ close/open/high/low/volume/ema/sma/rsi/atr/roc/macd_line/macd_signal/macd_hist/bb_upper/bb_mid/bb_lower/donchian_high/donchian_low. A CONDITION is {left:OPERAND, op, right:OPERAND}, op ∈ >,<,>=,<=,cross_above,cross_below. entryLong/entryShort/exitLong/exitShort are arrays of conditions (ALL must hold = AND). Examples: EMA20>EMA50 = {left:{ind:'ema',period:20},op:'>',right:{ind:'ema',period:50}}; RSI<30 = {left:{ind:'rsi',period:14},op:'<',right:{value:30}}; breakout = {left:{ind:'close'},op:'cross_above',right:{ind:'donchian_high',period:20}}. You can ALSO use DeFi macro factors as historical filters: defi_tvl_roc30 (30d % change in total DeFi TVL) and stablecoin_roc30 (30d % change in stablecoin supply) — e.g. only go long when capital is flowing in: {left:{ind:'defi_tvl_roc30'},op:'>',right:{value:0}}. Returns Sharpe/maxDD/winRate/CAGR/PF/equity curve. DEFAULT data is crypto perps (OKX). To backtest a TOKENIZED STOCK or ANY on-chain token instead, pass network (base, solana, arbitrum, eth, or robinhood for Robinhood Chain) PLUS the token's contract address (or a pool address) — history then comes from on-chain DEX candles (depth limited to what the DEX provides; prefer 1h/4h for new tokens).", {
        type: "object",
        properties: {
          symbol: { type: "string", description: "label, e.g. BTC, NVDA, or the token name" },
          network: { type: "string", description: "for on-chain backtests: base, solana, arbitrum, eth, robinhood" },
          address: { type: "string", description: "token contract address (on-chain backtest); its top pool is used" },
          pool: { type: "string", description: "explicit DEX pool address (on-chain backtest, optional)" },
          interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] },
          years: { type: "number", description: "years of history, e.g. 4" },
          direction: { type: "string", enum: ["long", "short", "both"] },
          entryLong: { type: "array", description: "conditions ANDed to enter long", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
          entryShort: { type: "array", description: "conditions to enter short (if direction includes short)", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
          exitLong: { type: "array", description: "optional: exit long when any condition true", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
          exitShort: { type: "array", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
          stopLossAtr: { type: "number", description: "stop = ATR(14) × this (e.g. 1.5)" },
          stopLossPct: { type: "number", description: "or a fixed % stop" },
          takeProfitR: { type: "number", description: "target = risk × this R (e.g. 2)" },
          takeProfitPct: { type: "number" },
          trailAtr: { type: "number", description: "trailing stop = ATR(14) × this" },
          riskPct: { type: "number", description: "% equity risked per trade, e.g. 1" },
          defiTrendFilter: { type: "boolean", description: "DeFi macro filter: longs only when total DeFi TVL is rising (risk-on)." },
        },
        required: ["symbol", "interval", "years", "direction", "riskPct"],
      }),
    ],
  },
  defillama: {
    capability: "DeFiLlama (tool: defi_data) — DeFi PROTOCOL/market data: protocol TVL, top yield pools (APY), and chain-level TVL. Use it for 'best yields', 'TVL of X', 'top chains'. NOTE: this is NOT wallet on-chain data.",
    tools: [{
      type: "function",
      function: {
        name: "defi_data",
        description: "DeFiLlama data. kind='protocol' (TVL/chains for a protocol slug), 'yields' (top APY pools, optional symbol/chain filter), or 'chains' (TVL by chain).",
        parameters: { type: "object", properties: { kind: { type: "string", enum: ["protocol", "yields", "chains"] }, query: { type: "string" } }, required: ["kind"] },
      },
    }],
  },
  moralis: {
    capability: "Moralis Money (tool: onchain_data) — WALLET/TOKEN on-chain analytics. Use it for on-chain / token / wallet questions AND as the fallback for any coin that has no perp market (memecoins, small caps). kinds: token_price (spot USD price + 24h change), token_metadata (name/supply/FDV/mcap/security score), token_analytics (buy vs sell volume, net volume, buyers/sellers by 5m/1h/6h/24h — use this for 'net buy volume'), token_holders, wallet_tokens, wallet_networth.",
    tools: [{
      type: "function",
      function: {
        name: "onchain_data",
        description: "On-chain data via Moralis. kind: token_price | token_metadata | token_analytics | token_holders | wallet_tokens | wallet_networth. For token kinds, address may be a 0x contract OR a known symbol (e.g. 'pepe','shib','link') which is auto-resolved; prefer the exact 0x contract when you already know it (reuse the address a prior token_metadata call returned). For wallet kinds, address is the wallet. chain defaults to eth (base, arbitrum, polygon, etc.).",
        parameters: { type: "object", properties: { kind: { type: "string", enum: ["token_price", "token_metadata", "token_analytics", "token_holders", "wallet_tokens", "wallet_networth"] }, address: { type: "string" }, chain: { type: "string" } }, required: ["kind", "address"] },
      },
    }],
  },
  opensea: {
    capability: "OpenSea (tools: nft_search, nft_collection, nft_trending, nft_wallet) — NFT marketplace data: search collections/items, floor prices & stats, trending collections, and NFTs held by a wallet. Use for any NFT question.",
    tools: [
      fnTool("nft_search", "AI-powered search across OpenSea for NFT collections, items, and tokens by name/query.", { type: "object", properties: { query: { type: "string" } }, required: ["query"] }),
      fnTool("nft_collection", "Floor price, volume, sales and stats for a specific NFT collection slug (e.g. boredapeyachtclub).", { type: "object", properties: { collection: { type: "string" } }, required: ["collection"] }),
      fnTool("nft_trending", "Trending NFT collections. timeframe: ONE_HOUR, ONE_DAY, or SEVEN_DAYS.", { type: "object", properties: { timeframe: { type: "string" } } }),
      fnTool("nft_wallet", "NFTs owned by a wallet address.", { type: "object", properties: { address: { type: "string" } }, required: ["address"] }),
    ],
  },
  robinhood: {
    capability: "Robinhood Chain (tool: hood_chain) — the OFFICIAL feed for Robinhood's new tokenized-stock L2 (chain 4663): 194 tokenized US stocks/ETFs (AAPL, NVDA, TSLA, HOOD, GOOG…) with live underlying bid/ask, daily volume, trading-halt status, contract addresses, and corporate actions (dividends/splits). Use this first for anything about Robinhood Chain / hood-chain tokenized stocks. For the ON-CHAIN DEX price, liquidity, volume, and candles of a Hood Chain token, pass its contract to dex_analytics with network=robinhood.",
    tools: [
      fnTool("hood_chain", "Robinhood Chain tokenized-stock data (official). kind=assets (list/search the 194 tokenized stocks + contracts + multiplier; optional query) | price (live underlying bid/ask + daily volume + halt status for a symbol like AAPL, NVDA, HOOD) | corporate_actions (dividends/splits, optional symbol filter).", {
        type: "object",
        properties: { kind: { type: "string", enum: ["assets", "price", "corporate_actions"] }, symbol: { type: "string", description: "ticker e.g. AAPL, NVDA, HOOD" }, query: { type: "string", description: "search text for kind=assets" } },
        required: ["kind"],
      }),
    ],
  },
  security: {
    capability: "Token Security (tool: token_security) — smart-contract RISK analysis via GoPlus for any token by contract on eth/base/arbitrum/optimism/bsc/polygon/avalanche: honeypot check, buy/sell tax, mint authority, ownership renounced?, pausable transfers, wallet blacklist, LP lock, holder concentration, and a computed risk level. ALWAYS run this before proposing to buy an unfamiliar/low-cap token.",
    tools: [
      fnTool("token_security", "Analyze a token's smart-contract risk (GoPlus): honeypot, taxes, mint/ownership, pausable/blacklist, LP lock, holders → risk flags + level. address = 0x contract; chain e.g. eth, base, arbitrum.", { type: "object", properties: { address: { type: "string" }, chain: { type: "string" } }, required: ["address"] }),
    ],
  },
  geckoterminal: {
    capability: "GeckoTerminal (tool: dex_analytics) — DEX/on-chain market data for ANY token by contract on 250+ chains including base, solana, eth, arbitrum, and robinhood (Robinhood Chain): live price/FDV/mcap/volume, pools + liquidity, OHLCV candles, and search to DISCOVER tokenized stocks (e.g. TSLAx, AAPL pools). Use network=robinhood for on-chain Hood Chain DEX data. Get a pool address via kind=pools then kind=ohlcv for candles.",
    tools: [
      fnTool("dex_analytics", "On-chain DEX analytics via GeckoTerminal. kind=token (price/FDV/mcap/volume by contract) | pools (top pools + liquidity + buy/sell for a token) | ohlcv (candles for a pool — get pool from kind=pools) | search (find tokens/pools by name, e.g. 'AAPL', 'TSLAx') | trending. network e.g. base, solana, eth, arbitrum.", {
        type: "object",
        properties: {
          kind: { type: "string", enum: ["token", "pools", "ohlcv", "search", "trending", "new_pools", "top_pools", "trades", "token_info"], description: "token=price/mcap; pools=liquidity; ohlcv=candles; search=find by name; trending/new_pools/top_pools=discovery; trades=recent swaps (buy/sell flow) for a pool; token_info=socials + GT trust score" },
          network: { type: "string", description: "base, solana, eth, arbitrum, polygon, optimism, bsc, avax" },
          address: { type: "string", description: "token contract (for kind=token/pools)" },
          pool: { type: "string", description: "pool address (for kind=ohlcv)" },
          query: { type: "string", description: "search text (for kind=search)" },
          interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] },
          limit: { type: "number" },
        },
        required: ["kind"],
      }),
    ],
  },
  ostium: {
    capability: "Ostium (tool: rwa_perp) — on-chain RWA & equity PERPETUALS (leveraged, USDC-settled, self-custody): live prices for US stocks (HOOD, NVDA, TSLA, AAPL, COIN, MSTR, META, GOOG, PLTR…), commodities (gold, oil), FX, and indices, each with market-open status. Use this to analyze or size directional/leveraged trades on stocks & RWAs. This is the perp price, not the spot share.",
    tools: [
      fnTool("rwa_perp", "Ostium RWA/equity perp data. kind=quote (live bid/mid/ask + market-open for a symbol like HOOD, NVDA, XAU) | markets (list available symbols, optional category: stock/commodity/index/fx/crypto).", {
        type: "object",
        properties: { kind: { type: "string", enum: ["quote", "markets"] }, symbol: { type: "string", description: "e.g. HOOD, NVDA, TSLA, XAU" }, category: { type: "string", enum: ["stock", "commodity", "index", "fx", "crypto"] } },
        required: ["kind"],
      }),
    ],
  },
  equities: {
    capability: "Equities/Finnhub (tool: stock_data) — REAL underlying US stock data: live quote, company profile, and fundamentals (P/E, 52w range, EPS). Use to compare a tokenized stock or stock-perp against the real share (premium/discount) and to add fundamental context.",
    tools: [
      fnTool("stock_data", "Underlying US equity data via Finnhub. kind=quote (live price/change) | profile (name/exchange/industry/mcap) | metrics (P/E, 52w high/low, EPS, dividend, beta). symbol e.g. AAPL, NVDA, HOOD.", {
        type: "object",
        properties: { kind: { type: "string", enum: ["quote", "profile", "metrics"] }, symbol: { type: "string" } },
        required: ["kind", "symbol"],
      }),
    ],
  },
  orderly: {
    capability: "Hyperliquid (execution & account) — perp execution, balance, positions, live PnL. Requires the user to create this agent's trading account in Wallet; until then, tell them to set it up.",
    tools: [],
  },
};

async function runTool(name: string, args: any) {
  if (name === "analyze_market") {
    const [snapshot, candles] = await Promise.all([
      getSnapshot(args.symbol).catch(() => null),
      getCandles(args.symbol, args.interval || "4h", 250).catch(() => [] as any[]),
    ]);
    // No perp listed for this symbol (e.g. small-cap / memecoin) — tell the agent to pivot.
    if ((!snapshot || snapshot.lastPrice == null) && (!candles || candles.length === 0)) {
      return { symbol: normalizeSymbol(args.symbol), available: false, hint: `No perpetual market is listed for ${String(args.symbol).toUpperCase()} on our execution venue, so live indicators aren't available. For a token like this, use onchain_data (kind=token_price for price, token_analytics for buy/sell/net volume, token_metadata for fundamentals) instead.` };
    }
    return { symbol: normalizeSymbol(args.symbol), available: true, snapshot, indicators: summarize(candles) };
  }
  if (name === "defi_data") return defiData(args.kind, args.query);
  if (name === "onchain_data") return onchain(args.kind, args.address, args.chain || "eth");
  if (name === "token_security") return tokenSecurity(args.chain || "eth", args.address);
  if (name === "hood_chain") return hoodChain(args);
  if (name === "dex_analytics") return dexAnalytics(args);
  if (name === "rwa_perp") return args.kind === "markets" ? ostiumMarkets(args.category) : ostiumQuote(args.symbol);
  if (name === "stock_data") return equityData(args.kind, args.symbol);
  if (name === "nft_search") return openseaSearch(args.query);
  if (name === "nft_collection") return openseaCollection(args.collection);
  if (name === "nft_trending") return openseaTrending(args.timeframe || "ONE_DAY");
  if (name === "nft_wallet") return openseaWallet(args.address);
  if (name === "backtest_strategy") {
    const years = Math.min(Math.max(args.years || 3, 0.25), 10);
    // On-chain source (GeckoTerminal) when a network/address/pool is given — backtests
    // tokenized stocks & any on-chain token, incl. Robinhood Chain (network=robinhood).
    const onchain = !!(args.network || args.address || args.pool);
    let candles, label = args.symbol, dataSource = "perp:okx";
    if (onchain) {
      const nw = args.network || "eth";
      const r = await fetchHistoryOnchain(nw, { pool: args.pool, address: args.address }, args.interval);
      candles = r.candles; label = args.symbol || args.address || r.pool; dataSource = `onchain:${nw}`;
    } else {
      candles = await fetchHistory(args.symbol, args.interval, years);
    }
    if (candles.length < 60) return { error: `Not enough history (${candles.length} bars) for a reliable backtest of ${label} ${args.interval}.${onchain ? " New/on-chain tokens often have limited candle history — try a shorter interval (e.g. 1h/4h) or a more liquid token." : ""}` };
    // Only fetch DeFi macro factors if the strategy actually references them.
    const usesFactors = ["entryLong", "entryShort", "exitLong", "exitShort"].some((k) =>
      (args[k] || []).some((cnd: any) => [cnd?.left?.ind, cnd?.right?.ind].some((x) => typeof x === "string" && (x.startsWith("defi_") || x.startsWith("stablecoin_")))));
    const factors = usesFactors ? await macroFactors(candles) : undefined;
    const riskOn = args.defiTrendFilter ? await defiRiskOnSeries(candles) : undefined;
    const res = runBacktest(candles, { ...args, years }, riskOn, factors);
    return { ...res, symbol: label, dataSource };
  }
  return { error: "unknown tool" };
}

export async function POST(req: NextRequest) {
  const { message, agentId, images } = (await req.json().catch(() => ({}))) as { message?: string; agentId?: string; images?: string[] };
  if (!message && !(images && images.length)) return new Response("message required", { status: 400 });
  const imgs = (images || []).filter((u) => typeof u === "string" && u.startsWith("data:image/")).slice(0, 4);

  const session = await getSession(req);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-5.6-sol";
  // GPT-5.x reasoning models reject function tools on chat.completions unless reasoning_effort is set.
  const reasoning: Record<string, unknown> = /^gpt-5/.test(model) ? { reasoning_effort: "none" } : {};

  let mcps: string[] = ["technical-analysis"];
  let agentName = "Midas";
  let instructions = "";
  let history: { role: "user" | "assistant"; content: string }[] = [];
  const persist = !!(agentId && session);
  if (persist) {
    await ensureAgentsTable();
    const r = await query<any>("SELECT name, instructions, mcps FROM agents WHERE id = $1 AND user_id = $2", [agentId, session!.userId]);
    if (r.rows[0]) { agentName = r.rows[0].name; mcps = r.rows[0].mcps ?? []; instructions = r.rows[0].instructions || ""; }
    // Persistent memory: replay this agent's prior conversation.
    history = (await loadAgentMessages(session!.userId, agentId!, 30)).map((m) => ({ role: m.role, content: m.content }));
  }

  // Build tools + a capability manifest from the agent's connected MCPs.
  const tools: Tool[] = [];
  const capabilities: string[] = [];
  for (const id of mcps) {
    if (id === "orderly") continue; // handled below (depends on connection state)
    const entry = MCP_REGISTRY[id];
    if (!entry) continue;
    capabilities.push(`- ${entry.capability}`);
    tools.push(...entry.tools);
  }

  // The agent's OWN live wallet (on-chain Base + Hyperliquid) — so it always knows what it holds.
  const onchainAcct = persist ? await loadKeysetPublic(session!.userId, agentId!) : null;
  // Hyperliquid trading — only when THIS agent has its own connected account.
  const hlAcct = mcps.includes("orderly") && persist ? await loadHlPublic(session!.userId, agentId!) : null;
  if (onchainAcct || hlAcct) {
    capabilities.push(`- Wallet (tools: get_wallet${onchainAcct ? ", place_swap" : ""}) — you HAVE a live trading wallet. ALWAYS call get_wallet first when asked to trade, allocate, or report holdings, so you act on real balances/positions.${onchainAcct ? ` On-chain (Base) address ${onchainAcct.evmAddress}: swap tokens with place_swap (tokenIn/tokenOut = eth/usdc/weth or a 0x contract). place_swap PROPOSES the swap — the user confirms before it executes; never claim it filled until confirmed.` : ""}${hlAcct ? " Hyperliquid connected — perps via place_trade." : ""} If balances are ~0, tell the user to fund the wallet in the app.`);
    tools.push(fnTool("get_wallet", "Your live wallet snapshot: on-chain Base balances (ETH, USDC, USD value) + Hyperliquid equity, free collateral and open positions with unrealized PnL.", { type: "object", properties: {} }));
    if (onchainAcct) tools.push(fnTool("place_swap", "Propose an on-chain spot swap on Base (Uniswap) from this agent's wallet. tokenIn/tokenOut = 'eth','usdc','weth' or a 0x contract; amountIn in human units. ETH output is delivered as WETH; no native unwrap is performed. PROPOSES only — the user confirms before it executes.", {
      type: "object", properties: { tokenIn: { type: "string" }, tokenOut: { type: "string" }, amountIn: { type: "number" }, slippagePct: { type: "number" } }, required: ["tokenIn", "tokenOut", "amountIn"],
    }));
  }
  if (mcps.includes("orderly")) {
    if (hlAcct) {
      capabilities.push("- Hyperliquid (tools: get_account, get_positions, place_trade) — this agent has its OWN segregated account. get_account/get_positions read live. place_trade PROPOSES an order the user must explicitly confirm before it executes — never claim a trade filled; report what you proposed.");
      tools.push(
        fnTool("get_account", "This agent's live Hyperliquid equity, free collateral and positions.", { type: "object", properties: {} }),
        fnTool("get_positions", "This agent's live open positions with unrealized PnL.", { type: "object", properties: {} }),
        fnTool("place_trade", "Propose a perp order on this agent's Hyperliquid account (user confirms before it fires). MARKET or LIMIT.", {
          type: "object",
          properties: {
            symbol: { type: "string", description: "e.g. BTC, ETH, SOL" },
            side: { type: "string", enum: ["long", "short"] },
            type: { type: "string", enum: ["MARKET", "LIMIT"] },
            quantity: { type: "number", description: "base-asset quantity" },
            price: { type: "number", description: "required for LIMIT" },
            stopLoss: { type: "number", description: "optional, for risk sizing" },
            reduceOnly: { type: "boolean" },
          },
          required: ["symbol", "side", "quantity"],
        })
      );
    } else {
      capabilities.push("- Hyperliquid: selected but this agent has NO trading account yet. Tell the user to create one in Wallet before any trading request.");
    }
  }

  // Living strategy — every agent can read/evolve its own versioned strategy (core, not an MCP).
  if (persist) {
    capabilities.push("- Strategy (tools: read_strategy, get_performance, update_strategy) — you have a VERSIONED, living strategy (prose thesis + a runnable spec). read_strategy shows the active version + recent performance. When evidence says your edge has changed, call update_strategy with an improved full spec + a clear rationale; it is automatically BACKTESTED and compared to your current strategy out-of-sample. If your auto-promote is on and the challenger wins, it activates; otherwise it's proposed for the user to approve. Never change strategy on a whim — justify it with data, and avoid overfitting.");
    const specProps = {
      symbol: { type: "string" }, network: { type: "string", description: "on-chain: base/solana/eth/arbitrum/robinhood" }, address: { type: "string", description: "on-chain token contract" }, pool: { type: "string" },
      interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] }, years: { type: "number" },
      direction: { type: "string", enum: ["long", "short", "both"] },
      entryLong: { type: "array", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
      entryShort: { type: "array", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
      exitLong: { type: "array", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
      exitShort: { type: "array", items: { type: "object", properties: { left: OPERAND, op: OP, right: OPERAND }, required: ["left", "op", "right"] } },
      stopLossAtr: { type: "number" }, stopLossPct: { type: "number" }, takeProfitR: { type: "number" }, takeProfitPct: { type: "number" }, trailAtr: { type: "number" }, riskPct: { type: "number" },
    };
    tools.push(
      fnTool("read_strategy", "Read this agent's active strategy (version, prose thesis, runnable spec, metrics) + recent performance + whether auto-promote is on.", { type: "object", properties: {} }),
      fnTool("get_performance", "This agent's performance: the ledger (logged backtests + trade entries by strategy version) PLUS liveTrading (actual realized PnL, closed trades, win rate from Hyperliquid). Review this — especially realized PnL per strategy version — before proposing a strategy change.", { type: "object", properties: {} }),
      fnTool("update_strategy", "Propose an evolved strategy. Provide the FULL new spec (same schema as backtest_strategy), an updated thesis, and a rationale. It is backtested and judged vs the current champion out-of-sample, then auto-promoted (if enabled) or proposed for approval.", {
        type: "object",
        properties: {
          thesis: { type: "string", description: "prose: the edge, when it works, risk rules" },
          rationale: { type: "string", description: "why this change, backed by evidence" },
          spec: { type: "object", description: "the runnable strategy (entry/exit conditions, stops, risk)", properties: specProps, required: ["interval", "direction", "riskPct"] },
        },
        required: ["thesis", "rationale", "spec"],
      })
    );
  }

  const notConnected: string[] = [];
  if (mcps.includes("moralis") && !moralisReady()) notConnected.push("Moralis (onchain_data)");
  if (mcps.includes("opensea") && !openseaReady()) notConnected.push("OpenSea (nft_* tools)");
  if (mcps.includes("equities") && !equitiesReady()) notConnected.push("Equities/Finnhub (stock_data)");
  const moralisNote = notConnected.length
    ? `\n(Note: ${notConnected.join(" and ")} are selected but no API key is configured yet, so those tools return a not-connected message.)`
    : "";

  const system = `You are "${agentName}", an agentic crypto trading assistant on Midas. You think briefly, call your connected MCP tools to get live data, then give clear, disciplined, conversational guidance citing real numbers.

Your connected MCPs and what each can do:
${capabilities.join("\n") || "- (none)"}${moralisNote}

Rules:
- Proactively call the right tool for the question. Do not say you "can't access" a source that is in your connected MCPs — call its tool instead.
- Match the source to the question: price/indicators → analyze_market; DeFi TVL/yields → defi_data; wallet/token on-chain → onchain_data.
- If analyze_market returns available:false (no perp listed — common for memecoins/small caps), do NOT stop or apologize vaguely. Immediately pivot to onchain_data (token_price, token_analytics, token_metadata) to answer with real numbers.
- When you already fetched a token's contract address (from token_metadata), REUSE that exact 0x address in follow-up onchain_data calls — never pass a bare symbol you could pass the address for, and never invent addresses.
- Format every reply in clean Markdown: **bold** labels, "- " bullet lists, and [text](url) links. Keep it scannable.
- If the user attaches a chart image, read it carefully — identify the asset/timeframe if labeled, and describe structure (trend, key levels, patterns, indicators visible). When the asset is identifiable, call analyze_market to confirm with live numbers rather than relying on the image alone. Be explicit about what you can and cannot tell from the image.
- Never claim a trade was executed; execution is a separate, explicitly-confirmed step.

Creator's instructions for you:
${instructions || "(none)"}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    ...history.map((h) => ({ role: h.role, content: h.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
    {
      role: "user",
      content: imgs.length
        ? [{ type: "text", text: message || "Analyze this chart." }, ...imgs.map((url) => ({ type: "image_url" as const, image_url: { url, detail: "auto" as const } }))]
        : message!,
    },
  ];
  const toolsUsed: { name: string; args: any }[] = [];

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        for (let round = 0; round < 5 && tools.length; round++) {
          const res = await client.chat.completions.create({ model, messages, tools, tool_choice: "auto", ...reasoning });
          const c = res.choices[0];
          if (c.finish_reason === "tool_calls" && c.message.tool_calls) {
            messages.push(c.message);
            for (const tc of c.message.tool_calls) {
              const args = JSON.parse(tc.function.arguments || "{}");
              send({ type: "tool", name: tc.function.name, args });
              toolsUsed.push({ name: tc.function.name, args });
              let result: any;
              try {
                const tn = tc.function.name;
                if (["get_wallet","get_account","get_positions","place_swap","place_trade"].includes(tn)) {
                  if(!persist || !agentId) throw new Error("Choose a saved agent first");
                  result=await sharedTool(tn==="place_swap"?"propose_swap":tn==="place_trade"?"propose_trade":tn,args,{userId:session!.userId,agentId});
                  if(result.proposed) result={...result,reviewUrl:"/trading?agentId="+agentId,note:"Review the stored order in Trading control. Nothing has been submitted."};
                } else if (tn === "read_strategy" && persist) {
                  const s = await getActiveStrategy(session!.userId, agentId!);
                  const autoPromote = await getAutoPromote(session!.userId, agentId!);
                  result = s
                    ? { version: s.version, thesis: s.thesis, spec: s.spec, metrics: s.metrics, autoPromote, recentPerformance: (await getPerf(session!.userId, agentId!, 5)) }
                    : { none: true, autoPromote, note: "No strategy defined yet. Call update_strategy with a thesis + runnable spec to create v1." };
                } else if (tn === "get_performance" && persist) {
                  const ledger = await getPerf(session!.userId, agentId!, 20);
                  // Live realized PnL from Hyperliquid (real trade outcomes), when this agent has an account.
                  let liveTrading = null;
                  if (hlAcct) {
                    const f = await hlUserFills(hlAcct.address, hlAcct.network).catch(() => null);
                    if (f) liveTrading = { network: hlAcct.network, realizedPnlUsd: f.realizedPnl, closedTrades: f.closes, winRatePct: f.winRatePct, recentFills: f.fills.slice(0, 10) };
                  }
                  result = { ledger, liveTrading, note: "ledger = logged backtests + trade entries by strategy version; liveTrading = actual realized PnL from Hyperliquid." };
                } else if (tn === "update_strategy" && persist) {
                  const invalid = validSpec(args.spec);
                  if (invalid) { result = { updated: false, error: invalid }; }
                  else {
                    const challEval = await backtestSpec(args.spec);
                    if (!challEval.ok) { result = { updated: false, error: `Could not backtest the candidate: ${challEval.error}` }; }
                    else {
                      const champ = await getActiveStrategy(session!.userId, agentId!);
                      const baseline = !champ; // no active strategy yet → this IS the baseline, adopt directly
                      const champEval = champ?.spec ? await backtestSpec(champ.spec).catch(() => null) : null;
                      const verdict = judge(champEval && "ok" in champEval && champEval.ok ? champEval : null, challEval);
                      const metrics = { basis: verdict.basis, challenger: challEval.oos ?? challEval.full, full: challEval.full };
                      await logPerf(session!.userId, agentId!, champ?.version ?? null, "backtest", { candidate: true, ...metrics });
                      const autoPromote = await getAutoPromote(session!.userId, agentId!);
                      if (baseline || (autoPromote && verdict.win)) {
                        const version = await addVersion(session!.userId, agentId!, { thesis: args.thesis, spec: args.spec, rationale: args.rationale, metrics, status: "active" });
                        const reason = baseline ? "adopted as the baseline strategy (no prior version)." : verdict.reason;
                        send({ type: "strategy_update", update: { agentId, version, activated: true, baseline, reason } });
                        result = { updated: true, activated: true, baseline, autoPromoted: !baseline, version, reason, metrics };
                      } else {
                        const version = await addVersion(session!.userId, agentId!, { thesis: args.thesis, spec: args.spec, rationale: args.rationale, metrics, status: "proposed" });
                        send({ type: "strategy_proposal", proposal: { agentId, version, thesis: args.thesis, rationale: args.rationale, verdict: verdict.reason, basis: verdict.basis, metrics, wins: verdict.win, autoPromote } });
                        result = { updated: false, proposed: true, version, awaitingApproval: true, verdict: verdict.reason, note: autoPromote ? "Auto-promote is on but the challenger did not clearly beat the champion, so it's proposed for approval." : "Proposed for user approval (auto-promote is off)." };
                      }
                    }
                  }
                } else {
                  result = await runTool(tn, args);
                }
              } catch (e) { result = { error: String(e) }; }
              // Backtest: push the equity curve to the client for a chart, give the LLM metrics only.
              if (tc.function.name === "backtest_strategy" && result?.equityCurve) {
                send({ type: "backtest", result });
                const { equityCurve, ...metrics } = result;
                result = metrics;
              }
              messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
            }
            continue;
          }
          break;
        }
        const finalStream = await client.chat.completions.create({ model, messages, stream: true, ...reasoning });
        let finalText = "";
        for await (const chunk of finalStream) {
          const d = chunk.choices[0]?.delta?.content;
          if (d) { finalText += d; send({ type: "delta", content: d }); }
        }
        send({ type: "done" });
        // Persist the turn so the agent remembers next time.
        if (persist) {
          await saveAgentMessage(session!.userId, agentId!, "user", imgs.length ? `${message || "Analyze this chart."}\n[${imgs.length} chart image(s) attached]` : message!).catch(() => {});
          await saveAgentMessage(session!.userId, agentId!, "assistant", finalText, toolsUsed.length ? toolsUsed : undefined).catch(() => {});
        }
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "chat failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
