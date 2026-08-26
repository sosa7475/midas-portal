import { NextRequest } from "next/server";
import OpenAI from "openai";
import { getSession } from "../../../lib/server/auth";
import { query } from "../../../lib/server/db";
import { ensureAgentsTable } from "../../../lib/server/agents-sql";
import { getCandles, getSnapshot, normalizeSymbol, summarize } from "../../../lib/server/market";
import { defiData } from "../../../lib/server/defi";

export const runtime = "nodejs";
export const maxDuration = 60;

const BASE_SYSTEM = `You are a Midas trading agent — an agentic crypto assistant. You think out loud briefly, call your connected tools to get live data, then give clear, disciplined guidance. Be concise and conversational (Claude-style). Cite real numbers. Never claim a trade was executed; execution is a separate, explicitly-confirmed step.`;

type Tool = OpenAI.Chat.Completions.ChatCompletionTool;

const TA_TOOL: Tool = {
  type: "function",
  function: {
    name: "analyze_market",
    description: "Live market snapshot + indicators (RSI, EMA, MACD, ATR, funding) for a perp symbol.",
    parameters: { type: "object", properties: { symbol: { type: "string" }, interval: { type: "string", enum: ["15m", "1h", "4h", "1d"] } }, required: ["symbol"] },
  },
};
const DEFI_TOOL: Tool = {
  type: "function",
  function: {
    name: "defi_data",
    description: "DeFiLlama data: protocol TVL, top yields, or chain TVL.",
    parameters: { type: "object", properties: { kind: { type: "string", enum: ["protocol", "yields", "chains"] }, query: { type: "string" } }, required: ["kind"] },
  },
};

async function runTool(name: string, args: any) {
  if (name === "analyze_market") {
    const [snapshot, candles] = await Promise.all([getSnapshot(args.symbol), getCandles(args.symbol, args.interval || "4h", 250)]);
    return { symbol: normalizeSymbol(args.symbol), snapshot, indicators: summarize(candles) };
  }
  if (name === "defi_data") return defiData(args.kind, args.query);
  return { error: "unknown tool" };
}

export async function POST(req: NextRequest) {
  const { message, agentId } = (await req.json().catch(() => ({}))) as { message?: string; agentId?: string };
  if (!message) return new Response("message required", { status: 400 });

  const session = getSession(req);
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const model = process.env.OPENAI_MODEL || "gpt-4o";

  // Load agent config (instructions + connected MCPs) if this is an agent chat.
  let system = BASE_SYSTEM;
  let mcps: string[] = ["technical-analysis"];
  let agentName = "Midas";
  if (agentId && session) {
    await ensureAgentsTable();
    const r = await query<any>("SELECT name, instructions, mcps FROM agents WHERE id = $1 AND user_id = $2", [agentId, session.userId]);
    if (r.rows[0]) {
      agentName = r.rows[0].name;
      mcps = r.rows[0].mcps ?? [];
      system = `${BASE_SYSTEM}\n\nYou are "${agentName}". Follow these instructions from your creator:\n${r.rows[0].instructions || "(none provided)"}`;
    }
  }

  const tools: Tool[] = [];
  if (mcps.includes("technical-analysis")) tools.push(TA_TOOL);
  if (mcps.includes("defillama")) tools.push(DEFI_TOOL);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: message },
  ];

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (o: unknown) => controller.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        for (let round = 0; round < 4 && tools.length; round++) {
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
