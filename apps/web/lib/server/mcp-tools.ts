import {needsEntryExit} from "./attached-exit";
import {spotValueUsd} from "./spot-valuation";
import {getAccounting} from "./accounting";
import {validateSchema} from "./json-schema";
import {query} from "./db";
import {getRisk} from "./agent-risk-sql";
import {listExitRules} from "./spot-exits";
import {operationStatus} from "./operations";
import {getReadiness} from "./readiness";
import {validateExecutionInput} from "./execution-input";
import {getOpenOrders,getOrder,cancelOrder,protectPosition,hlSymbol} from "./hyperliquid";
/**
 * The Midas tool surface exposed over MCP to external agents (Claude, ChatGPT).
 * Reuses the same engines the in-app agents use: analysis, strategy, monitoring, trading.
 * All tools are scoped to the connector's (user, agent).
 */
import { createExecution, executeOnce, recordTransaction, listExecutions, recheckAuthorization, recordVenueSubmission } from "./execution-orders";
import { getMandate } from "./mandate";
import { venueCapabilities, chainWallet } from "./venues";
import { publishTradeIdea, listTradeIdeas } from "./trade-ideas";
import {assertReviewCurrent,reviewedSwapMinimum} from "./swap-review";
import { swapOutput } from "../swap-output";
import { verifyRecordedSwaps } from "./swap-verification";
import { quoteBaseRouteTool } from "./base-route-tool";
import { getSnapshot, getCandles, normalizeSymbol, summarize } from "./market";
import { dexAnalytics } from "./geckoterminal";
import { hoodChain } from "./robinhood";
import { ostiumQuote, ostiumMarkets } from "./ostium";
import { onchain } from "./moralis";
import { defiData, defiRiskOnSeries, macroFactors } from "./defi";
import { equityData } from "./equities";
import { fetchHistory, fetchHistoryOnchain, runBacktest } from "./backtest";
import { getActiveStrategy, getAutoPromote, addVersion, getPerf, getTradePerf, logPerf } from "./strategy-sql";
import { backtestSpec, judge, validSpec } from "./strategy-review";
import { getAccount as hlGetAccount, markPrice as hlMarkPrice, getUserFills as hlUserFills, placeOrder as hlPlaceOrder } from "./hyperliquid";
import { loadHlPublic, loadHlSigner } from "./hl-sql";
import { checkOrder } from "./risk";
import { resolveToken, getDecimals, quoteSwap, executeSwap, CHAINS, nativeBalance, tokenBalance } from "./dex";
import { trackedBaseTokens, walletSnapshot } from "./wallet-snapshot";
import { tokenSecurity } from "./security";
import { enforceGuardrails } from "./agent-risk-sql";

const dayStartMs = () => Date.parse(new Date().toISOString().slice(0, 10) + "T00:00:00Z");
import { agentSignEvmTx } from "./turnkey";
import { loadKeysetSigner, loadKeysetPublic } from "./turnkey-sql";

export interface Ctx { userId: string; agentId: string; operationId?: string;runId?:string;connectorId?:string }
const S = (t: string) => ({ type: "string" as const, description: t });


const operandSchema = { type: "object", properties: {
  ind: { type: "string", enum: ["close", "open", "high", "low", "volume", "ema", "sma", "rsi", "atr", "roc", "macd_line", "macd_signal", "macd_hist", "bb_upper", "bb_mid", "bb_lower", "donchian_high", "donchian_low"] },
  period: { type: "integer", minimum: 1 }, mult: { type: "number" }, value: { type: "number" }
} };
const conditionsSchema = { type: "array", items: { type: "object", properties: {
  left: operandSchema, op: { type: "string", enum: [">", "<", ">=", "<=", "cross_above", "cross_below"] }, right: operandSchema
}, required: ["left", "op", "right"] } };

export const MCP_TOOLS: {name:string;description:string;inputSchema:Record<string,any>}[] = [
  {name:"get_open_orders",description:"Read live Hyperliquid orders including protective triggers.",inputSchema:{type:"object",properties:{}}},
  {name:"propose_position_action",description:"Prepare a reduce-only close, cancellation or native stop/target protection for an existing Hyperliquid position. Owner reviews exact action in Trading control.",inputSchema:{type:"object",properties:{action:{type:"string",enum:["close","cancel","protection"]},symbol:S("Market symbol"),orderId:{type:"integer"},stopLoss:{type:"number"},takeProfit:{type:"number"},requestKey:S("Stable retry key")},required:["action","symbol"]}},
  {name:"execute_order",description:"Execute an approved position-management proposal; the server verifies owner approval or a scoped mandate.",inputSchema:{type:"object",properties:{intent:S("Stored proposal ID")},required:["intent"]}},
  {name:"get_capabilities",description:"Supported venues, execution and account connection requirements, including Robinhood Chain.",inputSchema:{type:"object",properties:{}}},
  {name:"get_chain_wallet",description:"Read agent balances and tracked tokens on Base or Robinhood Chain. No transfers or provisioning.",inputSchema:{type:"object",properties:{chain:{type:"string",enum:["base","robinhood"]},tokenAddresses:{type:"array",maxItems:20,items:{type:"string"}}}}},
  {name:"list_orders",description:"Durable order lifecycle, approval and transaction status for this agent.",inputSchema:{type:"object",properties:{}}},
  {name:"get_mandate",description:"Read the owner's autonomous trading mandate. Agents cannot change it.",inputSchema:{type:"object",properties:{}}},
  {name:"get_spot_exits",description:"Owner-authorized deterministic spot exit rules and failures. Configure in Trading control.",inputSchema:{type:"object",properties:{}}},
  {name:"get_readiness",description:"Check credentials, account connection, strategy eligibility, worker health and unresolved orders before trading.",inputSchema:{type:"object",properties:{}}},
  {name:"get_alerts",description:"Read operational alerts and worker heartbeats for this agent.",inputSchema:{type:"object",properties:{}}},
  {name:"get_accounting",description:"Verified Midas fill ledger, FIFO realized amounts by quote token, separate network fees and explicit unmatched history.",inputSchema:{type:"object",properties:{}}},
  // ── Analysis ──
  { name: "analyze_market", description: "Live perp snapshot + indicators (RSI/EMA/MACD/ATR/funding/OI) for a symbol (BTC, ETH, SOL). Returns available:false for symbols with no perp — then use dex_analytics/hood_chain.", inputSchema: { type: "object", properties: { symbol: S("e.g. BTC"), interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] } }, required: ["symbol"] } },
  { name: "dex_analytics", description: "On-chain DEX data (GeckoTerminal) for ANY token by contract on 250+ chains incl base, solana, robinhood (Hood Chain). kind: token (price/mcap) | pools (liquidity) | ohlcv (candles) | search (find by name) | trending | new_pools (fresh launches) | top_pools | trades (recent swaps / buy-sell flow for a pool) | token_info (socials + GT trust score).", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["token", "pools", "ohlcv", "search", "trending", "new_pools", "top_pools", "trades", "token_info"] }, network: S("base, solana, eth, arbitrum, robinhood"), address: S("token contract"), pool: S("pool address for ohlcv/trades"), query: S("search text"), interval: { type: "string", enum: ["5m", "15m", "1h", "4h", "1d"] }, limit: { type: "number" } }, required: ["kind"] } },
  { name: "hood_chain", description: "Robinhood Chain tokenized stocks (official): kind=assets|price|corporate_actions. symbol e.g. AAPL, NVDA, HOOD.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["assets", "price", "corporate_actions"] }, symbol: S("ticker"), query: S("search") }, required: ["kind"] } },
  { name: "rwa_perp", description: "Ostium RWA/equity perp prices (HOOD, NVDA, TSLA, gold, FX, indices). kind=quote|markets.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["quote", "markets"] }, symbol: S("e.g. HOOD"), category: { type: "string", enum: ["stock", "commodity", "index", "fx", "crypto"] } }, required: ["kind"] } },
  { name: "onchain_data", description: "Moralis wallet/token analytics. kind: token_price|token_metadata|token_analytics|token_holders|wallet_tokens|wallet_networth. address = 0x contract or symbol; chain defaults eth.", inputSchema: { type: "object", properties: { kind: {type:"string",enum:["token_price","token_metadata","token_analytics","token_holders","wallet_tokens","wallet_networth"]}, address: S("0x or symbol/wallet"), chain: S("eth/base/…") }, required: ["kind", "address"] } },
  { name: "defi_data", description: "DeFiLlama. kind=protocol|yields|chains.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["protocol", "yields", "chains"] }, query: S("slug/symbol/chain") }, required: ["kind"] } },
  { name: "stock_data", description: "Underlying US equity data (Finnhub). kind=quote|profile|metrics. symbol e.g. AAPL.", inputSchema: { type: "object", properties: { kind: { type: "string", enum: ["quote", "profile", "metrics"] }, symbol: S("ticker") }, required: ["kind", "symbol"] } },
  { name: "backtest_strategy", description: "Backtest a strategy over history. OKX spot-price proxy by default (symbol), not perpetual execution or funding; OR on-chain token by passing network + address (base/solana/robinhood). Conditions: entryLong/entryShort/exitLong/exitShort = arrays of {left,op,right} where operand={ind,period,mult} or {value}; ind∈close/open/high/low/volume/ema/sma/rsi/atr/roc/macd_line/macd_signal/macd_hist/bb_upper/bb_mid/bb_lower/donchian_high/donchian_low; op∈>,<,>=,<=,cross_above,cross_below. Stops: stopLossAtr/stopLossPct; targets: takeProfitR/takeProfitPct; trailAtr; riskPct; maxHoldingBars; maxLeverage (default 1); feeBps and slippageBps per side; fixedCostUsdPerFill adds a constant USD network cost on entry and exit (default 0, not historical gas). Optional endTime (UTC milliseconds) freezes history, initialEquity sets simulated capital, includeTrades returns the simulated trade ledger.", inputSchema: { type: "object", properties: { symbol: S("BTC or token label"), network: S("on-chain: base/solana/robinhood/eth/arbitrum"), address: S("token contract for on-chain"), pool: S("optional pool"), interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] }, years: { type: "number" }, direction: { type: "string", enum: ["long", "short", "both"] }, entryLong: conditionsSchema, entryShort: conditionsSchema, exitLong: conditionsSchema, exitShort: conditionsSchema, stopLossAtr: { type: "number" }, stopLossPct: { type: "number" }, takeProfitR: { type: "number" }, takeProfitPct: { type: "number" }, trailAtr: { type: "number" }, riskPct: { type: "number" }, maxHoldingBars: { type: "integer", minimum: 1 }, maxLeverage: { type: "number", exclusiveMinimum: 0 }, feeBps: { type: "number", minimum: 0 }, slippageBps: { type: "number", minimum: 0 }, fixedCostUsdPerFill: { type: "number", minimum: 0 }, endTime: { type: "number", description: "Exclusive UTC timestamp in milliseconds; defaults to now" }, initialEquity: { type: "number", exclusiveMinimum: 0 }, includeTrades: { type: "boolean" } }, required: ["interval", "direction", "riskPct"] } },
  // ── Strategy (rules + monitoring) ──
  { name: "read_strategy", description: "This agent's active strategy (version, thesis, runnable spec, metrics), auto-promote state, and recent performance.", inputSchema: { type: "object", properties: {} } },
  { name: "get_performance", description: "Performance: ledger, Hyperliquid PnL and read-only receipt verification for recent recorded Base swaps, including actual raw token transfers. Base total fees and realized PnL remain incomplete.", inputSchema: { type: "object", properties: {} } },
  { name: "update_strategy", description: "Evolve the strategy: provide thesis, rationale, and a full runnable spec (same fields as backtest_strategy). It is backtested and judged vs the current champion out-of-sample, then auto-promoted (if enabled) or proposed.", inputSchema: { type: "object", properties: { thesis: S("prose edge/rules"), rationale: S("why this change, evidence"), spec: { type: "object" } }, required: ["thesis", "rationale", "spec"] } },
  // ── Account + trading (Hyperliquid) ──
  { name: "get_account", description: "This agent's Hyperliquid equity, free collateral, and open positions.", inputSchema: { type: "object", properties: {} } },
  { name: "get_wallet", description: "This agent's live Base native ETH and USDC balances plus tokens found in recent trading records or explicitly requested. Reports failed reads as unknown. coreValueUsd covers ETH/USDC only; total value and full token inventory are unknown. Includes Hyperliquid equity and positions.", inputSchema: { type: "object", properties: { baseTokenAddresses: { type: "array", maxItems: 20, items: { type: "string" }, description: "Optional additional Base ERC20 addresses to inspect." } } } },
  { name: "propose_trade", description: "Risk-check a perp order and get a signed intent to confirm. Returns violations if blocked, else a plan + intent token. Owner approves the stored order in Trading control before execute_trade, unless a valid autonomous mandate authorizes it.", inputSchema: { type: "object", properties: { symbol: S("BTC/ETH/SOL"), side: { type: "string", enum: ["long", "short"] }, quantity: { type: "number",exclusiveMinimum:0 }, stopLoss:{type:"number",exclusiveMinimum:0},takeProfit:{type:"number",exclusiveMinimum:0},requestKey:S("Stable retry key"),slippagePct:{type:"number",minimum:0,maximum:3}, price: { type: "number", description: "optional limit" } }, required: ["symbol", "side", "quantity"] } },
  { name: "execute_trade", description: "Place the trade from a prior propose_trade, using its intent token. Only call after the user confirms.", inputSchema: { type: "object", properties: { intent: S("intent token from propose_trade") }, required: ["intent"] } },
  // ── On-chain spot swaps (Uniswap, Turnkey-signed, trade-only) ──
  { name: "token_security", description: "Smart-contract RISK analysis (GoPlus) for a token by contract on eth/base/arbitrum/optimism/bsc/polygon/avalanche: honeypot, buy/sell tax, mint authority, ownership renounced?, pausable transfers, blacklist, LP lock, holder concentration → risk flags + level. Run before buying an unfamiliar token.", inputSchema: { type: "object", properties: { address: S("0x token contract"), chain: S("eth, base, arbitrum, optimism, bsc, polygon, avalanche") }, required: ["address"] } },
  { name: "compare_base_routes", description: "Read-only Base quote comparison: four Uniswap v3 fee tiers plus up to four supplied pools from the initial Aerodrome Slipstream factory, verified at one fresh block. Highest gross output is not net profit or an execution recommendation. Quotes are ERC20; ETH means WETH. Does not create an intent, sign, approve or execute. Full fees and token transfer behavior remain unverified.", inputSchema: { type: "object", properties: { tokenIn: S("Base symbol or token contract"), tokenOut: S("Base symbol or token contract"), amountIn: { type: "string", pattern: "^[0-9]+(\\.[0-9]+)?$", description: "Positive human-unit decimal string, e.g. 0.0005" }, slipstreamPools: { type: "array", maxItems: 4, items: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" }, description: "Explicit candidate Slipstream pool addresses; identities verified on-chain. Omit for v3 only." } }, required: ["tokenIn", "tokenOut", "amountIn"] } },
  { name: "quote_swap", description: "Read-only Uniswap v3 swap quotes across supported fee tiers at the same block. Returns gross-output comparison and gas units; does not sign, prepare an intent or execute. Native ETH output is WETH. Gas, approvals and price movement must be considered separately.", inputSchema: { type: "object", properties: { chain: S("base (default)"), tokenIn: S("symbol or 0x"), tokenOut: S("symbol or 0x"), amountIn: S("positive human-unit decimal string") }, required: ["tokenIn", "tokenOut", "amountIn"] } },
  { name: "publish_trade_idea", description: "Save a structured Base or Robinhood Chain swap recommendation for human review in Midas. Gets a fresh quote and stores a minimum output and expiry. No signer, intent or execution is triggered. Automatic-execution settings do not consume this queue.", inputSchema: {type:"object",additionalProperties:false,properties:{chain:{type:"string",enum:["base","robinhood"]},ideaKey:S("Stable unique identifier for this observation; reuse on retry"),tokenIn:S("Input symbol or contract"),tokenOut:S("Output symbol or contract; ETH resolves to WETH"),amountIn:S("Exact positive decimal string"),slippageBps:{type:"integer",minimum:0,maximum:300},strategyVersion:S("Research strategy identifier and version"),rationale:S("Entry rationale"),exitPlan:S("Exit conditions; these are advisory and not automatically executed"),invalidation:S("When the idea should be discarded"),evidence:S("Supporting observations and limitations")},required:["ideaKey","tokenIn","tokenOut","amountIn","slippageBps","strategyVersion","rationale","exitPlan","invalidation","evidence"]}},
  { name: "list_trade_ideas", description: "Read recent structured trade ideas and their review/submission statuses. Submitted does not mean filled; use receipt verification.", inputSchema:{type:"object",properties:{}}},
  { name: "propose_swap", description: "Prepare an on-chain spot swap (Uniswap on Base or Robinhood Chain): quotes it and returns a plan + intent token. tokenIn/tokenOut = 'usdc','weth','eth' or a 0x contract; amountIn as an exact decimal string. ETH output is delivered as WETH; no native unwrap is performed. Show the plan to the user, then execute_swap.", inputSchema: { type: "object", properties: { chain: S("base (default)"), tokenIn: S("symbol or 0x"), tokenOut: S("symbol or 0x"), amountIn: { type: "string",pattern:"^[0-9]+(\\.[0-9]+)?$" }, requestKey:S("Stable retry key"), slippagePct: { type: "number" } }, required: ["tokenIn", "tokenOut", "amountIn"] } },
  { name: "execute_swap", description: "Execute the swap from propose_swap's intent — Turnkey-signed and policy-gated to the router (trade-only). Only after the user confirms. Needs the agent's on-chain wallet funded (gas + tokenIn).", inputSchema: { type: "object", properties: { intent: S("intent from propose_swap") }, required: ["intent"] } },
];

async function backtestArgs(a: any) {
  const years = Math.min(Math.max(a.years || 3, 0.25), 10);
  let candles, label = a.symbol, dataSource = "spot-proxy:okx";
  if (a.network || a.address || a.pool) {
    if (a.endTime != null) throw new Error("Historical endTime is currently supported only for OKX candles");
    const r = await fetchHistoryOnchain(a.network || "eth", { pool: a.pool, address: a.address }, a.interval);
    candles = r.candles; label = a.symbol || a.address || r.pool; dataSource = `onchain:${a.network || "eth"}`;
  } else candles = await fetchHistory(a.symbol, a.interval, years, { endTime: a.endTime });
  if (candles.length <= 60) return { error: `Not enough history (${candles.length} bars) for ${label} ${a.interval}.` };
  const usesFactors = ["entryLong", "entryShort", "exitLong", "exitShort"].some((k) => (a[k] || []).some((c: any) => [c?.left?.ind, c?.right?.ind].some((x) => typeof x === "string" && (x.startsWith("defi_") || x.startsWith("stablecoin_")))));
  const factors = usesFactors ? await macroFactors(candles) : undefined;
  const riskOn = a.defiTrendFilter ? await defiRiskOnSeries(candles) : undefined;
  const res = runBacktest(candles, { ...a, years }, riskOn, factors, { initialEquity: a.initialEquity, includeTrades: a.includeTrades === true });
  const { equityCurve, ...metrics } = res as any;
  return { ...metrics, symbol: label, dataSource };
}

export async function callTool(name: string, args: any, ctx: Ctx): Promise<any> {
  const tool=MCP_TOOLS.find(t=>t.name===name);if(!tool)throw Error("Unknown tool");
  validateSchema(tool.inputSchema,args??{});
  validateExecutionInput(name,args);
  if(name === "execute_order") {
    const order=(await listExecutions(ctx)).find(o=>o.id===args.intent);if(!order||!["close","cancel","protection"].includes(order.kind))throw Error("Position-management order not found");
    return executeOnce(ctx,String(args.intent),order.kind,(payload,id)=>dispatch("manage_position",{intent:payload},{...ctx,operationId:id}));
  }
  if(name === "execute_trade" || name === "execute_swap") {
    return executeOnce(ctx, String(args.intent), name === "execute_trade" ? "trade" : "swap", (payload,id)=>dispatch(name,{intent:payload},{...ctx,operationId:id}));
  }
  return dispatch(name,args,{userId:ctx.userId,agentId:ctx.agentId,runId:ctx.runId});
}
async function dispatch(name: string, args: any, ctx: Ctx): Promise<any> {
  const { userId, agentId } = ctx;
  switch (name) {
    case "get_accounting":return getAccounting(ctx);
    case "get_spot_exits":return {rules:await listExitRules(ctx)};
    case "get_readiness":return getReadiness(ctx);
    case "get_alerts":return operationStatus(ctx);
    case "get_open_orders": {
      const a=await loadHlPublic(userId,agentId);if(!a)throw Error("Hyperliquid account not connected");
      return {orders:await getOpenOrders(a.address,a.network)};
    }
    case "propose_position_action": {
      const a=await loadHlPublic(userId,agentId);if(!a)throw Error("Hyperliquid account not connected");
      if(!["close","cancel","protection"].includes(args.action))throw Error("Unsupported position action");
      const symbol=hlSymbol(args.symbol);
      if(args.action==="cancel" && (!Number.isSafeInteger(args.orderId)||args.orderId<=0))throw Error("Order ID required");
      const order=await createExecution(ctx,args.action,`hl:${a.network}:${a.address.toLowerCase()}`,{t:args.action,symbol,account:a.address,network:a.network,orderId:args.orderId??null,stopLoss:args.stopLoss??null,takeProfit:args.takeProfit??null,slippagePct:0.5},args.requestKey);
      return {proposed:true,intent:order.id,plan:order.payload,reviewUrl:`/trading?agentId=${agentId}`};
    }
    case "manage_position": {
      if(!ctx.operationId)throw Error("Execution reservation required");
      const p=args.intent,a=await loadHlSigner(userId,agentId);if(!a||a.address!==p.account||a.network!==p.network)throw Error("Account changed");
      let result;
      if(p.t==="cancel") {
        const orders=await getOpenOrders(a.address,a.network);
        if(!orders.some((o:any)=>o.oid===p.orderId && o.coin===p.symbol))throw Error("Order is not open for this account and market");
        await recheckAuthorization(ctx,ctx.operationId);await recordVenueSubmission(ctx.operationId);
        result=await cancelOrder(a.privateKey,p.symbol,p.orderId,a.network);
      }else {
        const account=await hlGetAccount(a.address,a.network),position=account.positions.find((x:any)=>x.coin===p.symbol);
        if(!position)throw Error("No open position for this symbol");
        await recheckAuthorization(ctx,ctx.operationId);await recordVenueSubmission(ctx.operationId);
        if(p.t==="close")result=await hlPlaceOrder(a.privateKey,{symbol:p.symbol,side:position.szi>0?"short":"long",size:Math.abs(position.szi),reduceOnly:true,slippagePct:0.5,clientOrderId:`0x${ctx.operationId.replace(/-/g,"")}`},a.network);
        else result=await protectPosition(a.privateKey,p.symbol,position.szi,p.stopLoss,p.takeProfit??undefined,a.network,`0x${ctx.operationId.replace(/-/g,"")}`);
      }
      if((result as any).status!=="ok")throw Error("Venue rejected action");
      const statuses=(result as any).response?.data?.statuses??[];
      if(statuses.some((x:any)=>x.error))throw Error("Venue returned partial or failed protection/action; reconcile orders");
      return {placed:true,status:p.t==="cancel"?"cancelled":"submitted",venue:result};
    }
    case "get_capabilities": return venueCapabilities();
    case "list_orders": return {orders:await listExecutions(ctx)};
    case "get_chain_wallet": return chainWallet(ctx,args.chain||"base",args.tokenAddresses);
    case "get_mandate": return {mandate:await getMandate(userId,agentId)};
    case "analyze_market": {
      const [snapshot, candles] = await Promise.all([getSnapshot(args.symbol).catch(() => null), getCandles(args.symbol, args.interval || "4h", 250).catch(() => [] as any[])]);
      if ((!snapshot || snapshot.lastPrice == null) && (!candles || !candles.length)) return { symbol: normalizeSymbol(args.symbol), available: false, hint: "No perp listed — use dex_analytics or hood_chain." };
      return { symbol: normalizeSymbol(args.symbol), available: true, snapshot, indicators: summarize(candles) };
    }
    case "dex_analytics": return dexAnalytics(args);
    case "hood_chain": return hoodChain(args);
    case "rwa_perp": return args.kind === "markets" ? ostiumMarkets(args.category) : ostiumQuote(args.symbol);
    case "onchain_data": return onchain(args.kind, args.address, args.chain || "eth");
    case "defi_data": return defiData(args.kind, args.query);
    case "stock_data": return equityData(args.kind, args.symbol);
    case "backtest_strategy": return backtestArgs(args);

    case "read_strategy": {
      const s = await getActiveStrategy(userId, agentId);
      const autoPromote = await getAutoPromote(userId, agentId);
      return s ? { version: s.version, thesis: s.thesis, spec: s.spec, metrics: s.metrics, autoPromote, recentPerformance: await getPerf(userId, agentId, 5) } : { none: true, autoPromote, note: "No strategy yet — call update_strategy to create v1." };
    }
    case "get_performance": {
      const ledger = await getPerf(userId, agentId, 20);
      let liveTrading = null;
      let hyperliquidStatus: "not_connected" | "available" | "unavailable" = "not_connected";
      const acct = await loadHlPublic(userId, agentId);
      if (acct) {
        hyperliquidStatus = "unavailable";
        const f = await hlUserFills(acct.address, acct.network).catch(() => null);
        if (f) {
          hyperliquidStatus = "available";
          liveTrading = { realizedPnlUsd: f.realizedPnl, closedTrades: f.closes, winRatePct: f.winRatePct, recentFills: f.fills.slice(0, 10) };
        }
      }
      const wallet = await loadKeysetPublic(userId, agentId);
      const onchainVerification = wallet
        ? await getTradePerf(userId, agentId, 20).then(rows => verifyRecordedSwaps(rows, wallet.evmAddress)).catch(() => ({ status: "unavailable", note: "Recorded swap verification unavailable; not evidence of no trades." }))
        : { status: "not_connected" };
      const tradeIdeas = await listTradeIdeas(userId, agentId).then(ideas => ({status:"available",ideas})).catch(() => ({status:"unavailable",ideas:null}));
      return { ledger, liveTrading, onchainVerification, tradeIdeas, coverage: {
        complete: false,
        ledger: { limit: 20, scope: "Recent records; not a complete transaction history" },
        liveTrading: { venue: "hyperliquid", status: hyperliquidStatus, scope: "Returned fill history only; not lifetime or all-venue performance" },
        onchain: { status: "not_reconciled", realizedPnlUsd: null, note: "Swap entries are not matched to exits or complete network costs" },
        combinedRealizedPnlUsd: null,
        note: "Zero Hyperliquid PnL does not establish zero total trading PnL. Backtests are simulations, not realized profits."
      } };
    }
    case "update_strategy": {
      const invalid = validSpec(args.spec);
      if (invalid) return { updated: false, error: invalid };
      const challEval = await backtestSpec(args.spec);
      if (!challEval.ok) return { updated: false, error: `Could not backtest candidate: ${challEval.error}` };
      const champ = await getActiveStrategy(userId, agentId);
      const baseline = !champ;
      const compatible=champ?.spec && ["symbol","network","address","pool","interval","years","initialEquity","feeBps","slippageBps","fixedCostUsdPerFill"].every(k=>champ.spec[k]===args.spec[k]);
      if(champ && !compatible)return {updated:false,error:"Champion comparison requires the same asset, period, capital and cost assumptions"};
      const champEval = champ?.spec ? await backtestSpec(champ.spec,challEval.candles).catch(() => null) : null;
      const verdict = judge(champEval && "ok" in champEval && champEval.ok ? champEval : null, challEval);
      const metrics = { basis: verdict.basis, challenger: challEval.oos ?? challEval.full,dataHash:challEval.dataHash,evaluatedAt:challEval.evaluatedAt };
      await logPerf(userId, agentId, champ?.version ?? null, "backtest", { candidate: true, ...metrics });
      const autoPromote = await getAutoPromote(userId, agentId);
      if (verdict.win && autoPromote) {
        const version = await addVersion(userId, agentId, { thesis: args.thesis, spec: args.spec, rationale: args.rationale, metrics, status: "active" });
        return { updated: true, activated: true, baseline, version, reason: baseline ? "adopted as baseline" : verdict.reason, metrics };
      }
      const version = await addVersion(userId, agentId, { thesis: args.thesis, spec: args.spec, rationale: args.rationale, metrics, status: "proposed" });
      return { updated: false, proposed: true, version, verdict: verdict.reason, note: autoPromote ? "Did not clearly beat champion; proposed for approval." : "Proposed (auto-promote off). Approve in the Midas app." };
    }

    case "get_account": {
      const acct = await loadHlPublic(userId, agentId);
      if (!acct) return { connected: false, note: "No Hyperliquid account for this agent yet." };
      const a = await hlGetAccount(acct.address, acct.network);
      return { connected: true, network: acct.network, equity: a.equity, freeCollateral: a.freeCollateral, openPositions: a.openPositions, positions: a.positions };
    }
    case "get_wallet": {
      const out: any = {};
      const k = await loadKeysetPublic(userId, agentId);
      if (k) {
        let ledgerAvailable = true;
        const rows = await getPerf(userId, agentId, 100).catch(() => { ledgerAvailable = false; return []; });
        const addresses = trackedBaseTokens(rows, args.baseTokenAddresses, CHAINS.base.usdc!);
        const owner = k.evmAddress as `0x${string}`;
        const snapshot = await walletSnapshot(addresses, {
          native: () => nativeBalance("base", owner),
          usdc: () => tokenBalance("base", CHAINS.base.usdc!, owner),
          ethPrice: () => hlMarkPrice("ETH", "mainnet"),
          token: async (address) => {
            const decimals = await getDecimals("base", address);
            return { decimals, balance: await tokenBalance("base", address, owner) };
          },
        });
        if (!ledgerAvailable) snapshot.errors.push("Trading ledger unavailable; token discovery limited to explicit requests");
        out.onchain = { network: "base", address: k.evmAddress, ...snapshot, ledgerAvailable, withdrawalAddressSet: !!k.ownerAddress };
      }
      const hl = await loadHlPublic(userId, agentId);
      if (hl) { const a = await hlGetAccount(hl.address, hl.network); out.hyperliquid = { equity: a.equity, freeCollateral: a.freeCollateral, openPositions: a.openPositions, positions: a.positions }; }
      return Object.keys(out).length ? out : { note: "No wallet provisioned for this agent yet." };
    }
    case "propose_trade": {
      if(!["long","short"].includes(args.side)||!Number.isFinite(Number(args.quantity))||Number(args.quantity)<=0)throw new Error("Invalid trade side or quantity");

      const acct = await loadHlPublic(userId, agentId);
      if (!acct) return { proposed: false, reason: "No Hyperliquid account for this agent. Set one up in the Midas app." };
      const equity = (await hlGetAccount(acct.address, acct.network).catch(() => null))?.equity || 0;
      const refPrice = args.price ? Number(args.price) : (await hlMarkPrice(args.symbol, acct.network)) || 0;
      const verdict = checkOrder({ price: refPrice, quantity: Number(args.quantity), equityUsd: equity, stopLoss:args.stopLoss });
      if (!verdict.ok) return { proposed: false, blockedByRiskEngine: true, violations: verdict.violations };
      const strat = await getActiveStrategy(userId,agentId);
      const order = await createExecution(ctx,"trade",`hl:${acct.network}:${acct.address.toLowerCase()}`,{t:"trade",symbol:args.symbol,side:args.side,quantity:Number(args.quantity),price:args.price??null,notionalUsd:verdict.notionalUsd,account:acct.address,network:acct.network,strategyVersion:strat?.version??null,slippagePct:args.slippagePct??0.5,stopLoss:args.stopLoss??null,takeProfit:args.takeProfit??null},args.requestKey);
      const intent = order.id;
      return { proposed: true, plan: { symbol: args.symbol, side: args.side, quantity: Number(args.quantity), price: args.price ?? "market", refPrice, notionalUsd: Math.round(verdict.notionalUsd), network: acct.network }, intent, note: "Approve this order in Trading control, then execute; autonomous execution requires an owner mandate." };
    }
    case "execute_trade": {
      const p=args.intent;
      if(!ctx.operationId)throw new Error("Execution reservation required");
      const creds = await loadHlSigner(userId, agentId);
      if (!creds) return { placed: false, error: "No Hyperliquid account connected." };
      if(creds.address!==p.account || creds.network!==p.network)throw new Error("Account changed since proposal");
      const acct = await hlGetAccount(creds.address, creds.network);
      const refPrice = p.price ? Number(p.price) : (await hlMarkPrice(p.symbol, creds.network)) || 0;
      // Per-agent guardrails (kill switch, trades/day, daily loss) + per-trade caps.
      const fills = await hlUserFills(creds.address, creds.network).catch(() => null);
      const realizedToday = fills ? fills.fills.filter((f) => f.time >= dayStartMs()).reduce((a, f) => a + (f.closedPnl - f.fee), 0) : null;
      const gate = await enforceGuardrails(userId, agentId, { realizedPnlTodayUsd: realizedToday });
      if (!gate.ok) return { placed: false, blockedByGuardrails: true, violations: gate.violations };
      const L = gate.config;
      const openOrders=await getOpenOrders(creds.address,creds.network);
      const restingExposure=openOrders.filter((o:any)=>!o.reduceOnly).reduce((n:number,o:any)=>n+Number(o.limitPx)*Number(o.sz),0);
      const reserved=(await query("SELECT COALESCE(SUM((payload->>'notionalUsd')::numeric),0) AS total FROM execution_orders WHERE account_key=$1 AND id<>$2 AND status IN ('submitting','submitted','unknown','partially_filled','filled') AND created_at>NOW()-INTERVAL '2 minutes'",[`hl:${creds.network}:${creds.address.toLowerCase()}`,ctx.operationId])).rows[0]?.total??0;
      const mandate=await getMandate(userId,agentId);
      const totalExposure=acct.positions.reduce((n:number,x:any)=>n+Math.abs(x.value),0)+Math.max(restingExposure,Number(reserved))+refPrice*Number(p.quantity);
      if(!Number.isFinite(totalExposure) || totalExposure/acct.equity>(mandate?.enabled?Math.min(mandate.maxLeverage,L.maxLeverage??1):L.maxLeverage??1))throw new Error("Portfolio leverage cap exceeded");
      if(L.maxRiskPerTradePct!==null && !p.stopLoss)throw new Error("A native stop is required to measure configured per-trade risk");
      const verdict = checkOrder({ price: refPrice, quantity: Number(p.quantity), equityUsd: acct.equity,stopLoss:p.stopLoss??undefined }, { maxNotionalUsd: L.maxNotionalUsd ?? 1e12, maxLeverage: L.maxLeverage ?? 1e6, maxRiskPerTradePct: L.maxRiskPerTradePct ?? 100 });
      if (!verdict.ok) return { placed: false, blockedByRiskEngine: true, violations: verdict.violations };
      await recheckAuthorization(ctx,ctx.operationId!,verdict.notionalUsd);
      await recordVenueSubmission(ctx.operationId!);
      const result = await hlPlaceOrder(creds.privateKey, { symbol: p.symbol, side: p.side === "long" ? "long" : "short", size: Number(p.quantity), clientOrderId:`0x${ctx.operationId.replace(/-/g,"")}`, slippagePct:p.slippagePct, stopLoss:p.stopLoss??undefined,takeProfit:p.takeProfit??undefined, ...(p.price ? { price: Number(p.price) } : {}) }, creds.network);
      const st: any = (result as any)?.response?.data?.statuses?.[0];
      const err = (result as any)?.response?.data?.statuses?.find((x:any)=>x?.error)?.error || st?.error || ((result as any)?.status !== "ok" ? JSON.stringify(result) : null);
      if (err) throw new Error(`Venue order/protection error; reconcile before retry: ${err}`);
      const strat = await getActiveStrategy(userId, agentId);
      await logPerf(userId, agentId, strat?.version ?? null, "trade", { symbol: p.symbol, side: p.side, quantity: Number(p.quantity), avgPx: st?.filled?.avgPx ? Number(st.filled.avgPx) : refPrice, notionalUsd: Math.round(verdict.notionalUsd), via: "mcp", at: new Date().toISOString() }).catch(() => {});
      return { placed: true, status:st?.filled ? "filled" : "submitted", network: creds.network, order: st, notionalUsd: Math.round(verdict.notionalUsd) };
    }
    case "token_security": return tokenSecurity(args.chain || "eth", args.address);
    case "compare_base_routes": return quoteBaseRouteTool(args);
    case "quote_swap": {
      const chain = args.chain || "base";
      const tokenIn = resolveToken(chain, args.tokenIn), tokenOut = resolveToken(chain, args.tokenOut);
      const [decIn, decOut] = await Promise.all([getDecimals(chain, tokenIn), getDecimals(chain, tokenOut)]);
      const q = await quoteSwap(chain, tokenIn, tokenOut, String(args.amountIn), decIn, decOut);
      const {amountOutRaw, amountIn, ...details} = q;
      return {chain,tokenIn,tokenOut,amountIn:String(args.amountIn),decimalsIn:decIn,decimalsOut:decOut,...details};
    }
    case "publish_trade_idea": return publishTradeIdea(userId, agentId, args);
    case "list_trade_ideas": return { ideas: await listTradeIdeas(userId, agentId) };
    case "propose_swap": {
      const chain = args.chain || "base";
      const nativeIn = String(args.tokenIn).trim().toLowerCase() === "eth"; // native ETH input (no approval; router wraps)
      const tokenIn = resolveToken(chain, args.tokenIn), tokenOut = resolveToken(chain, args.tokenOut);
      const [decIn, decOut] = await Promise.all([nativeIn ? 18 : getDecimals(chain, tokenIn), getDecimals(chain, tokenOut)]);
      const q = await quoteSwap(chain, tokenIn, tokenOut, String(args.amountIn), decIn, decOut);
      const acct = await loadKeysetPublic(userId, agentId);
      if(!acct)throw new Error("Provision an agent wallet in Wallet first");
      const notionalUsd=await spotValueUsd(chain,tokenIn,String(args.amountIn),decIn);
      const strat=await getActiveStrategy(userId,agentId);
      const slip=Number(args.slippagePct??0.5);
      if(!Number.isFinite(slip)||slip<0||slip>3)throw new Error("Slippage must be between 0 and 3 percent");
      assertReviewCurrent(args.validUntilMs);
      const budgets=await getMandate(userId,agentId);
      const minimumOutRaw=reviewedSwapMinimum(q.amountOutRaw,q.amountOutRaw-q.amountOutRaw*BigInt(Math.round(slip*100))/10000n,args.minimumOutRaw).toString();
      const order=await createExecution(ctx,"swap",`evm:${CHAINS[chain].id}:${acct.evmAddress.toLowerCase()}`,{t:"swap",chain,tokenIn,tokenOut,amountInHuman:String(args.amountIn),decimalsIn:decIn,decimalsOut:decOut,exitPlan:budgets?.enabled&&budgets.spotExit&&needsEntryExit({t:"swap",chain,tokenIn,tokenOut})?budgets.spotExit:null,gasReserveEth:budgets?.gasReserveEth??"0.0001",maxGasEth:budgets?.maxGasEth??"0.0001",slippagePct:slip,nativeIn,minimumOutRaw,validUntilMs:args.validUntilMs??Date.now()+180000,notionalUsd,account:acct.evmAddress,strategyVersion:strat?.version??null},args.requestKey);
      const intent=order.id;
      const output = swapOutput(args.tokenOut, tokenOut, CHAINS[String(chain).toLowerCase()].wnative);
      return { proposed: true, plan: { chain, ...output, tokenOutAddress: tokenOut, sell: `${args.amountIn} ${args.tokenIn}`, buy: `~${q.amountOut} ${output.tokenOutLabel}`, feeTier: q.fee, wallet: acct?.evmAddress ?? null }, intent, note: acct ? "Approve this order in Trading control, then execute_swap. The wallet needs gas + the input token." : "This agent has no on-chain wallet yet — set one up in the Midas app first." };
    }
    case "execute_swap": {
      const p=args.intent;
      if(!ctx.operationId)throw new Error("Execution reservation required");
      const signer = await loadKeysetSigner(userId, agentId);
      if (!signer) return { placed: false, error: "No on-chain wallet for this agent. Set one up in the Midas app." };
      if(signer.evmAddress!==p.account)throw new Error("Wallet changed since proposal");
      if(p.exitPlan && (await query("SELECT 1 FROM spot_exit_rules WHERE chain=$1 AND account=$2 AND token_in=$3 AND status IN ('armed','executing','review_required')",[p.chain,p.account.toLowerCase(),p.tokenOut.toLowerCase()])).rows.length)throw Error("An exit rule already covers this asset; do not add another entry until it is resolved");
      // Reprice the input immediately before applying dollar limits.
      const notionalUsd = p.exitRuleId?null:await spotValueUsd(p.chain,p.tokenIn,p.amountInHuman,p.decimalsIn);
      await recheckAuthorization(ctx,ctx.operationId!,notionalUsd);
      const gate = p.exitRuleId?{ok:true,config:await getRisk(userId,agentId),violations:[]}:await enforceGuardrails(userId, agentId, { notionalUsd });
      if (!gate.ok) return { placed: false, blockedByGuardrails: true, violations: gate.violations };
      if(!p.exitRuleId && gate.config.maxNotionalUsd!==null && (notionalUsd===null || notionalUsd>gate.config.maxNotionalUsd))throw new Error("Input valuation unavailable or above the order cap");
      const sign = async (hex: string) => {await recheckAuthorization(ctx,ctx.operationId!,notionalUsd);return agentSignEvmTx(signer.subOrgId, signer.apiPublicKey, signer.apiPrivateKey, signer.evmAddress, hex);};
      try {
        const res = await executeSwap(p.chain, signer.evmAddress as `0x${string}`, sign, { tokenIn: p.tokenIn, tokenOut: p.tokenOut, amountInHuman: p.amountInHuman, decimalsIn: p.decimalsIn, decimalsOut: p.decimalsOut, slippagePct: p.slippagePct, nativeIn: p.nativeIn, minimumOutRaw:p.minimumOutRaw, validUntilMs:p.validUntilMs, gasReserveEth:p.gasReserveEth??"0.0001", maxGasEth:p.maxGasEth??"0.0001", onTransaction:(stage,hash)=>recordTransaction(ctx.operationId!,stage,hash) });
        const strat = await getActiveStrategy(userId, agentId);
        await logPerf(userId, agentId, strat?.version ?? null, "trade", { venue: "uniswap", chain: p.chain, tokenInAddr: String(p.tokenIn).toLowerCase(), tokenOutAddr: String(p.tokenOut).toLowerCase(), ...res, at: new Date().toISOString() }).catch(() => {});
        return { placed: true, ...res };
      } catch (e) { throw e; }
    }
    default: return { error: `Unknown tool: ${name}` };
  }
}
