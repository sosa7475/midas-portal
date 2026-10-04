/**
 * End-to-end test for the agent tool-calling loop.
 *
 * Verifies:
 *   1. Live DefiLlama tools (no key required)
 *   2. Live Orderly public market-data tools (no key required)
 *   3. Tool registry shape (schemas valid for both providers)
 *   4. buildToolResultMessage format for OpenAI + Anthropic
 *   5. Simulated multi-turn loop: assistant → tool_use → tool_result → final text
 *
 * Does NOT require: DATABASE_URL, JWT_SECRET, Moralis key, or a live LLM.
 * (The session-manager loop is not invoked directly because it touches
 * the conversations table; instead we re-implement the dispatch slice
 * here against a mock LLM to validate end-to-end agent behaviour.)
 */

require('dotenv').config();
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

const tools = require('./src/agents/agent-tools');
const { buildToolResultMessage } = require('./src/services/llm-adapter');

let pass = 0, fail = 0;
function ok(label, cond, detail = '') {
  if (cond) { console.log(`  PASS  ${label}${detail ? ' — ' + detail : ''}`); pass++; }
  else { console.log(`  FAIL  ${label}${detail ? ' — ' + detail : ''}`); fail++; }
}

(async () => {
  console.log('\n[1] Tool registry shape');
  const schemas = tools.getToolSchemas();
  ok('20 tools registered', schemas.length === 20, `got ${schemas.length}`);
  ok('all tools have name+description+input_schema',
    schemas.every((t) => t.name && t.description && t.input_schema));
  ok('all schemas declare object root',
    schemas.every((t) => t.input_schema.type === 'object'));

  console.log('\n[2] Live DefiLlama tools');
  try {
    const eth = await tools.runTool('defillama_chain_tvl', { chain: 'Ethereum' }, {});
    ok('defillama_chain_tvl Ethereum returns tvlUsd > 1B',
      typeof eth.tvlUsd === 'number' && eth.tvlUsd > 1e9,
      `$${(eth.tvlUsd / 1e9).toFixed(2)}B / 7d ${eth.change7d?.toFixed(2)}%`);
  } catch (e) { ok('defillama_chain_tvl', false, e.message); }

  try {
    const stables = await tools.runTool('defillama_stablecoin_flows', {}, {});
    ok('defillama_stablecoin_flows returns top stables array',
      Array.isArray(stables.top) && stables.top.length > 0,
      `total $${(stables.totalUsd / 1e9).toFixed(0)}B, top: ${stables.top[0]?.symbol}`);
  } catch (e) { ok('defillama_stablecoin_flows', false, e.message); }

  try {
    const perps = await tools.runTool('defillama_perps_volume', { chain: 'all' }, {});
    ok('defillama_perps_volume returns totalTvlUsd + topVenues',
      typeof perps.totalTvlUsd === 'number' && perps.totalTvlUsd > 0
        && Array.isArray(perps.topVenues) && perps.topVenues.length > 0,
      `TVL $${(perps.totalTvlUsd / 1e9).toFixed(2)}B / 7d ${perps.change7d?.toFixed(2)}% / top: ${perps.topVenues.slice(0,3).map(v=>v.name).join(', ')}`);
  } catch (e) { ok('defillama_perps_volume', false, e.message); }

  try {
    const prices = await tools.runTool('defillama_token_prices',
      { coins: ['coingecko:bitcoin', 'coingecko:ethereum', 'coingecko:solana'] }, {});
    ok('defillama_token_prices returns price array',
      Array.isArray(prices) && prices.length === 3,
      prices.map((p) => `${p.symbol}=$${p.priceUsd?.toFixed(0)}`).join(', '));
  } catch (e) { ok('defillama_token_prices', false, e.message); }

  console.log('\n[3] Live Orderly public market data');
  try {
    const t = await tools.runTool('orderly_ticker', { pair: 'PERP_BTC_USDC' }, {});
    ok('orderly_ticker BTC returns mark_price',
      typeof t.mark_price === 'number' && t.mark_price > 1000,
      `mark $${t.mark_price?.toFixed(0)} / 24h vol ${(t['24h_volume'] || 0).toFixed(0)}`);
  } catch (e) { ok('orderly_ticker', false, e.message); }

  try {
    const m = await tools.runTool('orderly_market_info', { pair: 'PERP_SOL_USDC' }, {});
    ok('orderly_market_info SOL returns base_tick',
      m && (m.base_tick || m.symbol),
      `tick ${m.base_tick} / min notional ${m.min_notional}`);
  } catch (e) { ok('orderly_market_info', false, e.message); }

  console.log('\n[4] Moralis tools require key (gracefully fail without one)');
  try {
    await tools.runTool('moralis_token_price',
      { chain: 'eth', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' }, {});
    ok('moralis without key throws clear error', false, 'no error thrown — should require key');
  } catch (e) {
    ok('moralis without key throws clear error',
      /Moralis API key/.test(e.message), e.message);
  }

  console.log('\n[5] buildToolResultMessage format');
  const fakeCalls = [{ id: 'call_1', name: 'defillama_chain_tvl', input: { chain: 'Solana' } }];
  const fakeResults = [{ chain: 'Solana', tvlUsd: 12_345_678_900 }];

  const oaiMsgs = buildToolResultMessage(fakeCalls, fakeResults, 'openai');
  ok('OpenAI tool_result is array of role:tool messages',
    Array.isArray(oaiMsgs) && oaiMsgs[0].role === 'tool' && oaiMsgs[0].tool_call_id === 'call_1');

  const anthMsg = buildToolResultMessage(fakeCalls, fakeResults, 'anthropic');
  ok('Anthropic tool_result is single user message with tool_result block',
    !Array.isArray(anthMsg) && anthMsg.role === 'user'
    && anthMsg.content[0].type === 'tool_result'
    && anthMsg.content[0].tool_use_id === 'call_1');

  console.log('\n[6] Simulated multi-turn agent loop');
  // Mock LLM that emits a tool_use, then a final text — exercising the loop.
  const turns = [];
  function mockLLM(turn) {
    if (turn === 0) {
      return Promise.resolve({
        type: 'tool_use',
        toolCalls: [{ id: 'call_a', name: 'defillama_perps_volume', input: { chain: 'all' } }],
        assistantMessage: { role: 'assistant', content: [{ type: 'tool_use', id: 'call_a', name: 'defillama_perps_volume', input: { chain: 'all' } }] },
      });
    }
    if (turn === 1) {
      return Promise.resolve({
        type: 'tool_use',
        toolCalls: [{ id: 'call_b', name: 'defillama_chain_tvl', input: { chain: 'Solana' } }],
        assistantMessage: { role: 'assistant', content: [{ type: 'tool_use', id: 'call_b', name: 'defillama_chain_tvl', input: { chain: 'Solana' } }] },
      });
    }
    return Promise.resolve({ type: 'text', content: 'Strategy synthesized using perp + Solana TVL data.' });
  }

  const convo = [{ role: 'user', content: 'Build a SOL strategy.' }];
  const trace = [];
  for (let i = 0; i < 6; i++) {
    const resp = await mockLLM(i);
    if (resp.type === 'text') {
      turns.push({ kind: 'text', text: resp.content });
      break;
    }
    convo.push(resp.assistantMessage);
    const results = await Promise.all(resp.toolCalls.map(async (tc) => {
      try { const r = await tools.runTool(tc.name, tc.input, {}); trace.push({ name: tc.name, ok: true }); return r; }
      catch (e) { trace.push({ name: tc.name, ok: false }); return { __error: true, error: e.message }; }
    }));
    convo.push(buildToolResultMessage(resp.toolCalls, results, 'anthropic'));
    turns.push({ kind: 'tool_round', tools: resp.toolCalls.map((c) => c.name), results: results.map((r) => r.__error ? 'ERR' : 'ok') });
  }

  ok('Loop ran 2 tool rounds + 1 text', turns.length === 3
    && turns[0].kind === 'tool_round' && turns[1].kind === 'tool_round' && turns[2].kind === 'text');
  ok('All tool calls succeeded',
    trace.every((t) => t.ok), `trace: ${JSON.stringify(trace)}`);
  ok('Final text emitted', /Strategy synthesized/.test(turns[turns.length - 1].text));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
})();
