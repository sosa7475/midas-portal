import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { ensureAgentsTable } from "../../../lib/server/agents-sql";
import { getCandles, getSnapshot, normalizeSymbol, summarize } from "../../../lib/server/market";
import { defiData } from "../../../lib/server/defi";
import { onchain, moralisReady } from "../../../lib/server/moralis";

export const runtime = "nodejs";
export const maxDuration = 60;

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

// One entry per MCP: how to describe it to the agent + the tools it unlocks.
const MCP_REGISTRY: Record<string, { capability: string; tools: Tool[] }> = {
  "technical-analysis": {
    capability: "Technical Analysis (tool: analyze_market) — live price, RSI, EMA, MACD, ATR, funding & open interest for any perp.",
    tools: [{
      type: "function",
      function: {
        name: "analyze_market",
        description: "Live market snapshot + indicators (RSI, EMA, MACD, ATR, funding, OI) for a perp symbol like BTC, ETH, SOL.",
        parameters: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] } }, required: ["symbol"] },
      },
    }],
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
  const moralisNote = mcps.includes("moralis") && !moralisReady()
    ? "\n(Note: Moralis is connected but no API key is configured yet, so onchain_data will return a not-connected message.)"
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
