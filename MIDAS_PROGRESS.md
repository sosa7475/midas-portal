# Midas — durable progress and review plan

Updated: 2026-09-11. Initial audit at repository commit 2579d0a.

## Authority and operating rules

Research, historical backtests and read-only monitoring are authorized. No paper trading. Platform implementation and deployment await plan review. Every live swap/trade requires the user's confirmation of its specific proposal through the Midas tools. Never bypass this through code or raw APIs. No assumed $50 deposit, no unrequested leverage, no forced trades, and no imposed fixed loss budget. Preserve the small bankroll and account for transaction costs. Coordinator owns the 30-minute schedule; do not create a duplicate.

## Verified connected state

- Base wallet: 0x1f2758e2B3366170cc87a0465F4075Abfe2feab6.
- get_wallet: 0.004499 ETH, 0 USDC, reported value $11.39. This is not a verified total portfolio value because other tokens are omitted.
- Hyperliquid: equity/free collateral $0; zero open positions.
- No active strategy; autoPromote false.
- Performance ledger contains one prior Base swap at 2026-09-11T14:43:33.625Z: 0.0005 ETH for 2.216123890831917223 units of 0x940181a94a35a4569e4529a3cdfb74e38fd98631. Transaction 0x13f2f1e3bbca3a8dbca49629f128c79451655eb3126d47a2947f6264de3ed952. This audit did not execute that trade. Current token balance, cost basis including gas, and realizable value remain unverified.
- Hyperliquid realized PnL $0 and closed trades 0 do not establish spot profitability.
- Moralis wallet_tokens lookup on Base failed with HTTP 404.
- ETH 4h snapshot: mark 2533.64, RSI14 57.66, EMA20 2491.31, EMA50 2479.53. Context only; not evidence of a profitable strategy.

## Backtests attempted

Both called Midas backtest_strategy for ETH, daily, 3 years, long-only, riskPct 0.5 and stopLossAtr 2. These are research parameters, not approved live risk settings.

1. Trend: EMA20 cross above EMA50 entry; cross below exit.
2. Pullback: close above SMA200 AND RSI14 below 40 entry; RSI14 above 60 exit.

Both failed: Cannot read properties of undefined (reading 'value'). Tool schema exposes condition arrays as strings; descriptions and local engine expect condition objects. Calls supplied JSON strings matching the exposed schema. No valid results, no demonstrated edge, no strategy promotion. Do not repeat unchanged failures every monitoring cycle.

## Concrete platform plan for review

1. Reconcile deployed source with this checkout before edits. Connected plugin uses Hyperliquid/Uniswap/Turnkey and strategy evolution, while local MCP README/server and web routes describe Orderly. Do not assume local findings prove deployed behavior.
2. Repair connector condition schema end to end: expose structured condition objects or safely parse/validate JSON strings; reject malformed inputs before engine entry. Verify both research strategies run and report actual history dates.
3. Repair wallet and PnL accounting: fix wallet_tokens endpoint, include ledger token contracts in balance reconciliation, show native gas reserve and token balances, and report spot realized/unrealized PnL separately from perpetuals. Verify the prior transaction receipt and current token holdings using read-only access.
4. Correct local backtester before using it to justify live activity (apps/web/lib/server/backtest.ts): trailing stop uses current close before testing the same candle's low/high; close-derived signals fill at that close; gap stops fill at the stop rather than a worse gap open; position sizing lacks cash/notional caps; starts at $10,000 with fixed bps and omits fixed gas; trade win rate/PF excludes entry fee even though equity deducts it; final liquidation is not reflected in the equity curve; history caps at 3,000 bars regardless of requested years. Add chronological execution, realistic gap fills, actual bankroll and spot cash constraints, gas/approval/fee/slippage costs, exact net trade metrics, and explicit coverage checks.
5. Review local execution safeguards (apps/web/app/api/orderly/order/route.ts and lib/server/risk.ts): validate finite positive numbers and enum values, make no leverage the default for this mandate, bind confirmation to expiring single-use exact order details, and ensure requested stops are actually submitted (current route uses stopLoss for risk checking but does not pass a stop to placeOrder). Verify these separately against the deployed service. Do not disable existing safeguards to honor the absence of a fixed loss limit.
6. Validate fixes with focused schema, candle-ordering/gap, cost accounting, cash cap, confirmation replay, and stop-order tests. Backtest chronological training/holdout periods and compare against ETH buy-and-hold and no transaction, with doubled cost sensitivity. No paper trading required.

## Trading decision process

Currently no new trade proposed. First reconcile all current holdings. Favor research into infrequent Base spot ETH/USDC decisions compatible with the funded venue; do not fund perpetuals or bridge on assumption. Evaluate the two preregistered candidates above without broad parameter mining. Run against actual available capital after gas reserve, include entry and exit costs and approval costs, and reject economically immaterial or cost-sensitive edges. Obtain current gas estimates rather than use a static cents assumption (Base official reference: https://docs.base.org/base-chain/api-reference/ethereum-json-rpc-api/eth_estimateGas).

Only after credible holdout results and current executable economics support an opportunity: prepare one specific proposal with amount, route, minimum output, costs, remaining ETH reserve, rationale and exit plan. Track pending proposal to avoid duplicates; wait for explicit user confirmation and refresh expired quotes.

## Next run and notifications

- Pending live proposal: none created by this task.
- Platform plan: awaiting review; no code or deployment changed.
- Refresh wallet, strategy and performance; compare with this checkpoint.
- Prioritize resolving omitted token balance and finding deployed source; rerun failed backtests only after evidence of schema repair or a supported interface change.
- Continue authorized read-only research. Notify only meaningful progress, actionable proposals, failures needing attention, or required input. Stay quiet on unchanged state.
