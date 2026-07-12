/**
 * Stateless agent — no in-process session state (BUILD_SPEC Phase 1).
 * Strategy + conversation history load from Postgres per request, so any Fly
 * machine can serve any request and state survives restarts.
 *
 * PHASE 2 replaces the single-shot call with the agentic tool-use loop.
 */
import type { TradeRecommendation } from "@midas/shared";
import { query } from "../db";
import { chat } from "../services/llm";

const SYSTEM_PROMPT = `You are Midas, an AI trading assistant that helps users execute crypto trades with emotional discipline.

Your role:
1. Analyze trade ideas and chart screenshots provided by the user
2. Apply the user's predefined strategy rules to evaluate trade ideas
3. Generate precise trade recommendations: pair, side (long/short), size, entry, stop-loss, take-profit
4. Maintain emotional discipline — flag when a trade idea violates the user's strategy
5. Never execute trades without user confirmation
6. Be concise, clear, and direct. No fluff.

When analyzing a trade:
- Check if it aligns with the user's strategy rules
- Identify key technical levels
- Suggest position sizing based on risk parameters
- Clearly state your reasoning

Always structure trade recommendations in this format:
TRADE RECOMMENDATION
Pair: [e.g. PERP_BTC_USDC]
Side: [Long / Short]
Entry: [price]
Size: [amount]
Stop-Loss: [price] ([% risk])
Take-Profit: [price] ([R:R ratio])
Reasoning: [2-3 sentences]

If the trade violates the user's strategy, say so clearly and explain why.`;

interface ProcessParams {
  userId: string;
  userMessage: string;
  imageBase64?: string | null;
  imageMimeType?: string | null;
  userApiKey?: string | null;
  userProvider?: "openai" | "anthropic" | null;
  onDelta?: (delta: string) => void;
}

async function loadActiveStrategy(userId: string) {
  const result = await query(
    `SELECT rules_text, parsed_rules_json FROM strategies
     WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0] ?? null;
}

async function loadRecentHistory(userId: string, limit = 20) {
  const result = await query(
    `SELECT role, content FROM conversations
     WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows.reverse() as { role: "user" | "assistant"; content: string }[];
}

async function saveMessage(
  userId: string,
  role: "user" | "assistant",
  content: string,
  metadata: Record<string, unknown> | null = null
) {
  await query(
    "INSERT INTO conversations (user_id, role, content, metadata) VALUES ($1, $2, $3, $4)",
    [userId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
}

export async function processMessage(p: ProcessParams) {
  // Fresh per-request loads — no cross-request memory.
  const [strategy, history] = await Promise.all([
    loadActiveStrategy(p.userId),
    loadRecentHistory(p.userId),
  ]);

  let system = SYSTEM_PROMPT;
  if (strategy) {
    system += `\n\nUser's Trading Strategy:\n${strategy.rules_text}`;
    if (strategy.parsed_rules_json) {
      system += `\n\nParsed Rules: ${JSON.stringify(strategy.parsed_rules_json)}`;
    }
  } else {
    system +=
      "\n\nNote: This user has not defined a strategy yet. Encourage them to define one via the Strategy tab.";
  }

  const messages = [...history, { role: "user" as const, content: p.userMessage }];
  await saveMessage(p.userId, "user", p.userMessage);

  const response = await chat({
    messages,
    systemPrompt: system,
    apiKey: p.userApiKey,
    provider: p.userProvider,
    imageBase64: p.imageBase64,
    imageMimeType: p.imageMimeType,
    onDelta: p.onDelta,
  });

  const assistantText = response.content;
  const tradeRecommendation = extractTradeRecommendation(assistantText);
  await saveMessage(
    p.userId,
    "assistant",
    assistantText,
    tradeRecommendation ? { tradeRecommendation } : null
  );

  return { content: assistantText, tradeRecommendation };
}

export function extractTradeRecommendation(text: string): TradeRecommendation | null {
  if (!text.includes("TRADE RECOMMENDATION")) return null;

  const pair = text.match(/Pair:\s*([A-Z_]+)/i);
  const side = text.match(/Side:\s*(Long|Short)/i);
  const entry = text.match(/Entry:\s*\$?([\d,.]+)/i);
  const size = text.match(/Size:\s*\$?([\d,.]+)/i);
  const sl = text.match(/Stop-Loss:\s*\$?([\d,.]+)/i);
  const tp = text.match(/Take-Profit:\s*\$?([\d,.]+)/i);

  if (!pair || !side) return null;

  const num = (m: RegExpMatchArray | null) =>
    m ? parseFloat(m[1].replace(/,/g, "")) : null;

  return {
    pair: pair[1],
    side: side[1].toLowerCase() as "long" | "short",
    entry: num(entry),
    size: num(size),
    stopLoss: num(sl),
    takeProfit: num(tp),
  };
}
