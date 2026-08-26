import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { ensureAgentsTable } from "../../../lib/server/agents-sql";
import { getCandles, getSnapshot, normalizeSymbol, summarize } from "../../../lib/server/market";
import { defiData } from "../../../lib/server/defi";
import { onchain, moralisReady } from "../../../lib/server/moralis";
import { openseaSearch, openseaCollection, openseaTrending, openseaWallet, openseaReady } from "../../../lib/server/opensea";
import { fetchHistory, runBacktest } from "../../../lib/server/backtest";

export const runtime = "nodejs";
export const maxDuration = 120;

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

function fnTool(name: string, description: string, parameters: Record<string, unknown>): Tool {
  return { type: "function", function: { name, description, parameters } };
}

// One entry per MCP: how to describe it to the agent + the tools it unlocks.
const MCP_REGISTRY: Record<string, { capability: string; tools: Tool[] }> = {
  "technical-analysis": {
    capability: "Technical Analysis (tools: analyze_market, backtest_strategy) — live price/RSI/EMA/MACD/ATR/funding, PLUS deterministic multi-year backtesting. When asked to backtest, translate the strategy into backtest_strategy params and report Sharpe, max drawdown, win rate, CAGR, profit factor.",
    tools: [
      fnTool("analyze_market", "Live market snapshot + indicators (RSI, EMA, MACD, ATR, funding, OI) for a perp symbol like BTC, ETH, SOL.", { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] } }, required: ["symbol"] }),
      fnTool("backtest_strategy", "Backtest a strategy over several years of real exchange history. YOU translate the agent's strategy into these parameters; all provided entry conditions must hold together. Returns Sharpe, max drawdown, win rate, CAGR, profit factor, # trades, equity curve.", {
        type: "object",
        properties: {
          symbol: { type: "string", description: "e.g. BTC, ETH, SOL" },
          interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] },
          years: { type: "number", description: "years of history, e.g. 3" },
          direction: { type: "string", enum: ["long", "short", "both"] },
          emaFast: { type: "number", description: "fast EMA for trend filter (e.g. 20); omit for no trend filter" },
          emaSlow: { type: "number", description: "slow EMA for trend filter (e.g. 50)" },
          rsiEntryBelow: { type: "number", description: "enter when RSI below this (mean-reversion), e.g. 35" },
          rsiEntryAbove: { type: "number", description: "enter when RSI above this (momentum), e.g. 55" },
          useMacd: { type: "boolean", description: "require MACD histogram to agree with direction" },
          stopAtrMult: { type: "number", description: "stop = ATR × this, e.g. 1.5" },
          takeProfitR: { type: "number", description: "target = risk × this R, e.g. 2" },
          riskPct: { type: "number", description: "% equity risked per trade, e.g. 1" },
        },
        required: ["symbol", "interval", "years", "direction", "stopAtrMult", "takeProfitR", "riskPct"],
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
    capability: "Moralis Money (tool: onchain_data) — WALLET/TOKEN on-chain analytics: token price/metadata, wallet holdings & net worth, token holders. Use it for on-chain / wallet / holder questions.",
    tools: [{
      type: "function",
      function: {
        name: "onchain_data",
        description: "On-chain data via Moralis. kind: token_price | token_metadata | token_holders | wallet_tokens | wallet_networth. address = token contract or wallet. chain defaults to eth (base, arbitrum, polygon, etc.).",
        parameters: { type: "object", properties: { kind: { type: "string" }, address: { type: "string" }, chain: { type: "string" } }, required: ["kind", "address"] },
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
  orderly: {
    capability: "Orderly (execution & account performance) — perp execution, balance, positions, PnL, Sharpe. Requires the user to connect their Orderly account in Wallet; until then, tell them to connect it.",
    tools: [],
  },
};

async function runTool(name: string, args: any) {
  if (name === "analyze_market") {
    const [snapshot, candles] = await Promise.all([getSnapshot(args.symbol), getCandles(args.symbol, args.interval || "4h", 250)]);
    return { symbol: normalizeSymbol(args.symbol), snapshot, indicators: summarize(candles) };
  }
  if (name === "defi_data") return defiData(args.kind, args.query);
  if (name === "onchain_data") return onchain(args.kind, args.address, args.chain || "eth");
  if (name === "nft_search") return openseaSearch(args.query);
  if (name === "nft_collection") return openseaCollection(args.collection);
  if (name === "nft_trending") return openseaTrending(args.timeframe || "ONE_DAY");
  if (name === "nft_wallet") return openseaWallet(args.address);
  if (name === "backtest_strategy") {
    const years = Math.min(Math.max(args.years || 3, 0.25), 10);
    const candles = await fetchHistory(args.symbol, args.interval, years);
    if (candles.length < 60) return { error: `Not enough history for ${args.symbol} ${args.interval}` };
    return runBacktest(candles, { ...args, years });
  }
  return { error: "unknown tool" };
}

export async function POST(req: NextRequest) {
  const { message, agentId } = (await req.json().catch(() => ({}))) as { message?: string; agentId?: string };
  if (!message) return new Response("message required", { status: 400 });

  const session = getSession(req);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  let mcps: string[] = ["technical-analysis"];
  let agentName = "Midas";
  let instructions = "";
  if (agentId && session) {
    await ensureAgentsTable();
    const r = await query<any>("SELECT name, instructions, mcps FROM agents WHERE id = $1 AND user_id = $2", [agentId, session.userId]);
    if (r.rows[0]) { agentName = r.rows[0].name; mcps = r.rows[0].mcps ?? []; instructions = r.rows[0].instructions || ""; }
  }

  // Build tools + a capability manifest from the agent's connected MCPs.
  const tools: Tool[] = [];
  const capabilities: string[] = [];
  for (const id of mcps) {
    const entry = MCP_REGISTRY[id];
    if (!entry) continue;
    capabilities.push(`- ${entry.capability}`);
    tools.push(...entry.tools);
  }
  const notConnected: string[] = [];
  if (mcps.includes("moralis") && !moralisReady()) notConnected.push("Moralis (onchain_data)");
  if (mcps.includes("opensea") && !openseaReady()) notConnected.push("OpenSea (nft_* tools)");
  const moralisNote = notConnected.length
    ? `\n(Note: ${notConnected.join(" and ")} are selected but no API key is configured yet, so those tools return a not-connected message.)`
    : "";

  const system = `You are "${agentName}", an agentic crypto trading assistant on Midas. You think briefly, call your connected MCP tools to get live data, then give clear, disciplined, conversational guidance citing real numbers.

Your connected MCPs and what each can do:
${capabilities.join("\n") || "- (none)"}${moralisNote}

Rules:
- Proactively call the right tool for the question. Do not say you "can't access" a source that is in your connected MCPs — call its tool instead.
- Match the source to the question: price/indicators → analyze_market; DeFi TVL/yields → defi_data; wallet/token on-chain → onchain_data.
- Never claim a trade was executed; execution is a separate, explicitly-confirmed step.

Creator's instructions for you:
${instructions || "(none)"}`;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: message },
  ];

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        for (let round = 0; round < 5 && tools.length; round++) {
          const res = await client.chat.completions.create({ model, messages, tools, tool_choice: "auto" });
          const c = res.choices[0];
          if (c.finish_reason === "tool_calls" && c.message.tool_calls) {
            messages.push(c.message);
            for (const tc of c.message.tool_calls) {
              const args = JSON.parse(tc.function.arguments || "{}");
              send({ type: "tool", name: tc.function.name, args });
              let result: unknown;
              try { result = await runTool(tc.function.name, args); } catch (e) { result = { error: String(e) }; }
              messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 8000) });
            }
            continue;
          }
          break;
        }
        const finalStream = await client.chat.completions.create({ model, messages, stream: true });
        for await (const chunk of finalStream) {
          const d = chunk.choices[0]?.delta?.content;
          if (d) send({ type: "delta", content: d });
        }
        send({ type: "done" });
      } catch (e) {
        send({ type: "error", error: e instanceof Error ? e.message : "chat failed" });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
}
