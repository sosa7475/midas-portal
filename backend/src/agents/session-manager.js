/**
 * Agent session manager.
 * Maintains per-user conversation state and strategy memory in-process (MVP).
 * Routes LLM calls through llm-adapter (OpenAI by default, switchable).
 */

const { chat } = require('../services/llm-adapter');
const { query } = require('../db/client');

// In-memory session store: userId -> { strategy, conversationHistory }
const sessions = new Map();

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

function getSession(userId) {
  if (!sessions.has(userId)) {
    sessions.set(userId, { strategy: null, history: [] });
  }
  return sessions.get(userId);
}

async function loadUserStrategy(userId) {
  const result = await query(
    'SELECT rules_text, parsed_rules_json FROM strategies WHERE user_id = $1 AND is_active = true ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  if (result.rows.length === 0) return null;
  return result.rows[0];
}

async function loadRecentHistory(userId, limit = 20) {
  const result = await query(
    'SELECT role, content FROM conversations WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2',
    [userId, limit]
  );
  return result.rows.reverse();
}

async function saveMessage(userId, role, content, metadata = null) {
  await query(
    'INSERT INTO conversations (user_id, role, content, metadata) VALUES ($1, $2, $3, $4)',
    [userId, role, content, metadata ? JSON.stringify(metadata) : null]
  );
}

async function processMessage({ userId, userMessage, imageBase64 = null, imageMimeType = null, userApiKey = null, userProvider = null }) {
  const session = getSession(userId);

  // Load strategy if not cached
  if (!session.strategy) {
    session.strategy = await loadUserStrategy(userId);
  }

  // Load conversation history if session just started
  if (session.history.length === 0) {
    session.history = await loadRecentHistory(userId);
  }

  let systemWithStrategy = SYSTEM_PROMPT;
  if (session.strategy) {
    systemWithStrategy += `\n\nUser's Trading Strategy:\n${session.strategy.rules_text}`;
    if (session.strategy.parsed_rules_json) {
      systemWithStrategy += `\n\nParsed Rules: ${JSON.stringify(session.strategy.parsed_rules_json, null, 2)}`;
    }
  } else {
    systemWithStrategy += '\n\nNote: This user has not defined a strategy yet. Encourage them to define one via the Strategy tab.';
  }

  // Add user message to history
  session.history.push({ role: 'user', content: userMessage });
  await saveMessage(userId, 'user', userMessage);

  // Call LLM
  const response = await chat({
    messages: session.history,
    apiKey: userApiKey,
    provider: userProvider,
    imageBase64,
    imageMimeType,
    systemPrompt: systemWithStrategy,
  });

  const assistantText = response.type === 'text' ? response.content : JSON.stringify(response);

  // Add assistant response to history
  session.history.push({ role: 'assistant', content: assistantText });

  // Parse trade recommendation if present
  const tradeRec = extractTradeRecommendation(assistantText);
  await saveMessage(userId, 'assistant', assistantText, tradeRec ? { tradeRecommendation: tradeRec } : null);

  // Keep in-memory history bounded
  if (session.history.length > 40) session.history = session.history.slice(-40);

  return { content: assistantText, tradeRecommendation: tradeRec };
}

function extractTradeRecommendation(text) {
  if (!text.includes('TRADE RECOMMENDATION')) return null;

  const pairs = text.match(/Pair:\s*([A-Z_]+)/i);
  const side = text.match(/Side:\s*(Long|Short)/i);
  const entry = text.match(/Entry:\s*([\d,.]+)/i);
  const size = text.match(/Size:\s*([\d,.]+)/i);
  const sl = text.match(/Stop-Loss:\s*([\d,.]+)/i);
  const tp = text.match(/Take-Profit:\s*([\d,.]+)/i);

  if (!pairs || !side) return null;

  return {
    pair: pairs[1],
    side: side[1].toLowerCase(),
    entry: entry ? parseFloat(entry[1].replace(',', '')) : null,
    size: size ? parseFloat(size[1].replace(',', '')) : null,
    stopLoss: sl ? parseFloat(sl[1].replace(',', '')) : null,
    takeProfit: tp ? parseFloat(tp[1].replace(',', '')) : null,
  };
}

function invalidateStrategyCache(userId) {
  const session = getSession(userId);
  session.strategy = null;
}

module.exports = { processMessage, invalidateStrategyCache, loadUserStrategy };
