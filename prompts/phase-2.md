# Phase 2 — Analysis engine (the "MCPs")

**Read first:** `BUILD_SPEC.md` §3 (Phase 2), §0 (analysis decision), §5 (security). **Prerequisite:** Phase 1 DoD green.

## Scope
Give the agent real market awareness. Build `packages/analysis` (data providers + indicators, exposed as MCP-shaped LLM tools) and `packages/agent` (a real agentic tool-use loop). No UI charts yet beyond what's needed to verify.

## Tasks
- [ ] `packages/analysis` provider clients (normalized interface, Upstash cache, timeout/retry/rate-limit): Orderly public (candles, orderbook, funding, OI, mark/index), Crypto.com Exchange (ticker, candles, orderbook, trades), CoinDesk (indices/news), FMP (fundamentals/news).
- [ ] `compute_indicators`: RSI, MACD, EMA/SMA, ATR, VWAP, Bollinger, support/resistance from OHLCV.
- [ ] Expose all as **MCP-shaped tool definitions** (name, description, JSON schema) — swapping a real MCP server later must require no change to `packages/agent`.
- [ ] `packages/agent`: real tool-use loop — LLM may call tools, `apps/api` executes them, results feed back until a final answer. Wire `tools` through the LLM adapter (currently supported but never passed → dead path).
- [ ] Ground the system prompt in: user strategy rules + live account state (for sizing) + tool outputs. Stream tool-call activity to the client ("fetching BTC orderbook…").

## Definition of Done
- [ ] "Should I long BTC here?" → agent demonstrably calls ≥2 market tools (visible in a trace/log) and returns a recommendation citing real numbers (price, ATR-based stop, funding).
- [ ] Screenshot analysis is corroborated with live data for the same pair.
- [ ] Each provider client has unit tests with recorded fixtures; tool schemas validate.
- [ ] Swapping a provider for a real MCP server needs no `packages/agent` change.
- [ ] Security: provider keys in server env only; no secret leakage in tool output or logs; input to tools validated.

**Stop when green.** Report a sample agent trace and blockers for Phase 3.
