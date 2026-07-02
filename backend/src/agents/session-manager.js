/**
 * Agent session manager.
 * Per-user conversation state, strategy memory, and an agent loop that
 * lets the LLM call onchain + market tools (DefiLlama, Moralis, Orderly)
 * to gather context before answering.
 */

const { chat, buildToolResultMessage } = require('../services/llm-adapter');
const { query } = require('../db/client');
const { getToolSchemas, runTool } = require('./agent-tools');
const { getUserMoralisKey } = require('../routes/onchain');

const MAX_TOOL_TURNS = 6; // hard cap on tool-call rounds per user message
const sessions = new Map();

const SYSTEM_PROMPT = `You are Midas, an AI trading agent for Orderly perps. You help users design strategies and evaluate trade ideas with emotional discipline.

You have tools to gather live onchain + market context. USE THEM proactively when:
  - The user asks about a token, chain, protocol, or market.
  - You need to evaluate a trade idea (always check Orderly ticker + onchain context for the asset).
  - The user wants to build a strategy that references onchain signals.
  - You need to verify fundamentals before recommending a low-cap trade.

Tool selection guide:
  - defillama_*  : protocol/chain TVL, DEX & perp volumes, stablecoin flows, yields. No setup required.
  - moralis_*    : token prices, holder concentration, wallet PnL/swaps, top gainers. Requires user's Moralis key.
  - orderly_*    : current Orderly perp ticker / market info. Always use before sizing a trade.

Trade recommendation format (when proposing a specific trade):
TRADE RECOMMENDATION
Pair: PERP_<SYMBOL>_USDC
Side: Long | Short
Entry: <price>
Size: <base units>
Stop-Loss: <price> (<% of equity at risk>)
Take-Profit: <price> (<R:R>)
Reasoning: 2-3 sentences citing the onchain or market data you pulled.

Strategy building format (when designing a strategy):
- Express rules as concrete, testable conditions referencing tool outputs (e.g. "long SOL only if 7d net stablecoin mints on Solana > 0 AND Orderly funding < 0.01%").
- Always include risk parameters: max % per trade, max leverage, min R:R, daily loss cap.

Be concise and direct. No fluff. If a trade idea violates the user's strategy, say so explicitly.`;

function getSession(userId) {
  if (!sessions.has(userId)) sessions.set(userId, { strategy: null, history: [] });
  return sessions.get(userId);
}

async function loadUserStrategy(userId) {
  const r = await query(
    'SELECT rules_text, parsed_rules_json FROM strategies WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  return r.rows[0] || null;
}

async function loadRecentHistory(userId, limit = 20) {
  const r = await query(
    'SELECT role, content FROM conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return r.rows.reverse();
}

async function saveMessage(userId, role, content, metadata = null) {
  await query(
    'INSERT INTO conversations (user_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
    [userId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
}

async function processMessage({ userId, userMessage, imageBase64 = null, imageMimeType = null, userApiKey = null, userProvider = null }) {
  const session = getSession(userId);

  if (!session.strategy) session.strategy = await loadUserStrategy(userId);
  if (session.history.length === 0) session.history = await loadRecentHistory(userId);

  let systemWithStrategy = SYSTEM_PROMPT;
  if (session.strategy) {
    systemWithStrategy += `\n\nUser's Trading Strategy:\n${session.strategy.rules_text}`;
    if (session.strategy.parsed_rules_json) {
      systemWithStrategy += `\n\nParsed Rules: ${JSON.stringify(session.strategy.parsed_rules_json, null, 2)}`;
    }
  } else {
    systemWithStrategy += '\n\nNote: This user has not defined a strategy yet. Encourage them to define one via the Strategy tab.';
  }

  // Append user message
  session.history.push({ role: 'user', content: userMessage });
  await saveMessage(userId, 'user', userMessage);

  // Tool context (decrypted Moralis key, if any)
  const toolCtx = {
    userId,
    moralisKey: await getUserMoralisKey(userId).catch(() => null),
  };
  const tools = getToolSchemas();

  // Conversation we send to the model. We mutate this within the agent loop
  // so multi-step tool reasoning works (assistant → tool_use → tool_result → final text).
  const convo = [...session.history];
  let imgB64 = imageBase64;
  let imgMime = imageMimeType;
  let toolTurns = 0;
  const toolTrace = []; // saved on the final assistant message metadata

  while (true) {
    const response = await chat({
      messages: convo,
      tools,
      apiKey: userApiKey,
      provider: userProvider,
      imageBase64: imgB64,
      imageMimeType: imgMime,
      systemPrompt: systemWithStrategy,
    });
    // After first turn the image (if any) has been seen — don't resend it on subsequent loops
    imgB64 = null;
    imgMime = null;

    if (response.type === 'text') {
      const finalText = response.content;
      session.history.push({ role: 'assistant', content: finalText });
      const tradeRec = extractTradeRecommendation(finalText);
      const meta = {
        ...(tradeRec ? { tradeRecommendation: tradeRec } : {}),
        ...(toolTrace.length ? { toolCalls: toolTrace } : {}),
      };
      await saveMessage(userId, 'assistant', finalText, Object.keys(meta).length ? meta : null);
      if (session.history.length > 40) session.history = session.history.slice(-40);
      return { content: finalText, tradeRecommendation: tradeRec, toolCalls: toolTrace };
    }

    // tool_use — run all requested tools in parallel
    toolTurns++;
    if (toolTurns > MAX_TOOL_TURNS) {
      const msg = `(Stopped after ${MAX_TOOL_TURNS} tool rounds — try a more specific question.)`;
      session.history.push({ role: 'assistant', content: msg });
      await saveMessage(userId, 'assistant', msg, { toolCalls: toolTrace, capped: true });
      return { content: msg, tradeRecommendation: null, toolCalls: toolTrace };
    }

    convo.push(response.assistantMessage);

    const results = await Promise.all(
      response.toolCalls.map(async (tc) => {
        try {
          const out = await runTool(tc.name, tc.input, toolCtx);
          toolTrace.push({ name: tc.name, input: tc.input, ok: true });
          return out;
        } catch (e) {
          toolTrace.push({ name: tc.name, input: tc.input, ok: false, error: e.message });
          return { __error: true, error: e.message };
        }
      })
    );

    const toolResultMsg = buildToolResultMessage(response.toolCalls, results, userProvider);
    if (Array.isArray(toolResultMsg)) convo.push(...toolResultMsg);
    else convo.push(toolResultMsg);
  }
}

function extractTradeRecommendation(text) {
  if (!text || !text.includes('TRADE RECOMMENDATION')) return null;
  const pair = text.match(/Pair:\s*([A-Z_]+)/i);
  const side = text.match(/Side:\s*(Long|Short)/i);
  const entry = text.match(/Entry:\s*([\d,.]+)/i);
  const size = text.match(/Size:\s*([\d,.]+)/i);
  const sl = text.match(/Stop-Loss:\s*([\d,.]+)/i);
  const tp = text.match(/Take-Profit:\s*([\d,.]+)/i);
  if (!pair || !side) return null;
  return {
    pair: pair[1],
    side: side[1].toLowerCase(),
    entry: entry ? parseFloat(entry[1].replace(/,/g, '')) : null,
    size: size ? parseFloat(size[1].replace(/,/g, '')) : null,
    stopLoss: sl ? parseFloat(sl[1].replace(/,/g, '')) : null,
    takeProfit: tp ? parseFloat(tp[1].replace(/,/g, '')) : null,
  };
}

function invalidateStrategyCache(userId) {
  const session = getSession(userId);
  session.strategy = null;
}

module.exports = { processMessage, invalidateStrategyCache, loadUserStrategy };
