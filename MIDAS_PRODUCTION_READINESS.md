# Midas production readiness and autonomous trading plan

> Implementation update (October 4): this document records the pre-change audit. See [MIDAS_IMPLEMENTATION.md](MIDAS_IMPLEMENTATION.md) for implemented controls, verification and remaining launch blockers.

Audit date: October 3, 2026 America/New_York (live observation October 4 UTC).

**Verdict: a capable trading prototype with useful research and execution components, but not ready for unattended production capital.** The principal work is a reliable, authorized, recoverable trading system around the tools—not adding another indicator or giving the LLM broader credentials. Production readiness and a profitable strategy are separate gates; neither guarantees the other.

## Scope and evidence

Reviewed the committed monorepo at 2579d0a in this worktree and the substantially newer, uncommitted implementation at `/Users/agility/Documents/agility-automations/Apps/midas-portal`. File references below refer to that newer main folder unless marked legacy. Inspected account onboarding, custody, OAuth/MCP, chat, risk, research/promotion, swaps, perpetual orders, portfolio accounting, data access, persistence and deployment scaffolding. Queried connected Midas wallet and active strategy read-only.

Web type-check passed. All 76 existing web server tests passed using a temporary TypeScript-to-CommonJS loader, without changing source. These include backtests, route quotes, receipt verification, wallet snapshots, human-review ideas, and existing simulation module unit tests; no paper-trading session was started. A local pure-function check confirmed `checkOrder` accepts negative and NaN quantity with `ok:true`. No orders, account connections, policy changes or deployments were performed. No destructive or exploit testing was attempted.

Limits: this is a source/read-only readiness audit, not a penetration-test certification. Deployment commit, runtime settings, signer policy state, restore capability, complete transaction history and all provider entitlements were not independently verified. Browser journeys, full mobile/API builds, venue integration tests and live execution were not exercised. Do not assume every local issue is deployed or that uncommitted fixes are deployed. The current connector tool catalog still lacks newer local tools such as `quote_swap`, `compare_base_routes` and trade-idea publication; reconcile connector schema/version with server deployment.

## What is already built

- Multi-agent web UI, user sessions, agent-scoped accounts, encrypted stored credentials, hashed connector tokens, OAuth with PKCE checks.
- Market indicators; on-chain data, token security, DeFi and equity/RWA lookups. Data availability is broader than actual execution support.
- Hyperliquid order submission and EVM Uniswap swaps with Turnkey signing. Solana wallet provisioning does not establish Solana trading support.
- Strategy versioning, backtesting and challenger/champion comparison using a final 30% holdout.
- New backtest fixes: next-open signals, gap-aware stops, delayed trailing updates, fee accounting, notional caps, small initial capital, optional fixed costs, history coverage/data-quality checks. Earlier audit findings in these areas are partly resolved.
- Same-block Uniswap fee-tier comparison and read-only Base/Aerodrome route comparison.
- Human-review trade ideas with deduplication, atomic claim and preserved minimum output. This is stronger than the older general execution path and should become the common foundation.
- Receipt verification and honest incomplete-coverage labels in newer MCP wallet/performance paths. These improvements have not propagated to every UI/API path.

## Current connected state

Wallet reports 0.004497005687280159 native ETH, 0 USDC, 0.000498110191187724 WETH and negligible remaining units of the prior token. Native ETH/USDC core value is $12.12; total wallet value is explicitly unknown. Hyperliquid equity and positions are zero. The inventory is bounded to recent ledger-discovered/requested tokens, not a complete index.

Strategy v1 is active, autoPromote is true, and its stored holdout metrics are return -1%, Sharpe -0.34, profit factor 0.95, 29 trades. This does not establish a deployable edge. The newer promotion evaluator would reject these metrics, but there is no demonstrated migration/requalification of existing active strategies. Execution also does not require a qualified strategy. Auto-promotion and auto-execution are different settings; only the former was observed live.

## Launch blockers, in priority order

### 1. Enforce authorization in the execution service

`apps/web/app/api/mcp/route.ts:25` changes tool descriptions according to autoExecute, while `lib/server/mcp-tools.ts:199` and `:246` accept signed intents without a persisted human approval or an enforced autonomous grant. The connector can obtain the intent itself. The manual-mode boundary therefore relies on the client obeying text. A signature proves server issuance, not human approval.

Required: separate research, propose, approve and execute permissions. Manual execution must require a stored owner approval of exact terms. Autonomous execution must require a user-created, revocable grant with agent/account, venue, chain, assets, allocation, leverage policy, slippage, expiry and strategy eligibility. Recheck the grant at dispatch and signing. The model cannot grant itself permissions, change risk settings or authorize transfers. Existing connected tools explicitly require confirmation and must continue to be used that way until the product contract is deliberately changed.

### 2. Remove JWT purpose confusion and repair connector lifecycle

`lib/server/auth.ts:getSession` verifies JWT signature/expiry using JWT_SECRET but does not enforce session type, audience, issuer or required claim shape. OAuth authorization/refresh tokens and trade intents use the same secret and contain userId. Static analysis indicates these other-purpose JWTs can be accepted as user sessions through the Authorization fallback. An agent-scoped credential must never become owner-wide authority. This was not exploited against a service.

`app/api/oauth/token/route.ts:28` verifies but does not atomically consume authorization codes. Refresh tokens are reused, not rotated/revoked as a family. `lib/server/mcp-auth.ts:34` has no expiration check even though OAuth advertises expires_in. OAuth routes have a development signing-secret fallback. MCP tokens can be passed in URLs and expose all tools for that agent; the MCP dispatcher has no central schema validation, request budget or batch concurrency limit.

Required: typed/audience-bound tokens with separate signing keys or domains; fail startup on missing secrets; one-time authorization codes; rotating refresh grants and revocation; enforced access-token expiry/scopes; bearer headers; schema validation and per-user/provider quotas. Test that OAuth codes, refresh tokens and trade intents are rejected as sessions. Add session invalidation on password reset, account recovery and sensitive changes.

### 3. Make an order durable before it can move money

MCP trade/swap intents are reusable within five minutes, with no atomic single-use claim or client-order identifier. Repeated calls can produce new signed transactions. Ledger writes occur after execution and failures are swallowed. `agent-risk-sql.ts` counts these best-effort records for daily trade limits, creating both missing-record and concurrent-check races.

`dex.ts:177` returns after swap broadcast, not final receipt. Its amountOut is a quote. Approval receipt status is not checked; nonce allocation uses getTransactionCount without a shared per-wallet reservation. Process interruption between signing, broadcasting and recording leaves ambiguity. There is no durable replacement/retry/reorg reconciler in the reviewed application.

Required: transactional order reservation and an outbox; unique intent/order IDs and idempotency keys; wallet/venue concurrency control; states from proposed → authorized → reserved → submitted → partial/filled/reverted/cancelled/unknown; record hashes and venue order IDs; reconcile before retrying unknown outcomes. Persist signed transaction identity securely before broadcast, subject to credential-handling policy. Never call a quote a fill or a broadcast a successful trade.

### 4. Make risk gates fail closed and measure the whole portfolio

`risk.ts:29` passes negative and NaN quantities. Guardrails skip capped dimensions when measurements are null. MCP swaps price only USDC inputs; ETH and other tokens can skip a dollar cap. Perp PnL fetch failures become null and skip a configured loss gate. Leverage checks examine this order divided by equity, not existing positions plus open orders. `hyperliquid.ts` substitutes equity when withdrawable is legitimately zero. Risk-setting numeric coercion permits NaN, which JSON serialization can turn into null/no-limit.

Required: positive finite decimal validation, venue lot/tick/minimum checks, fresh account data, atomic capital reservations, gross/net portfolio exposure, gas reserve and maximum transaction cost, asset/venue concentration and liquidity constraints. If a configured check cannot be measured, block new risk and explain why. Preserve separately authorized reduce-only exits during an entry pause. A user-selected absence of a fixed daily loss budget is distinct from missing data or unlimited leverage.

### 5. Give the agent complete position management

New MCP perp tools expose open/submit but no open-order list, order status, cancel/replace, reduce-only close or protective-order management. `app/api/hl/order/route.ts` reads stopLoss for risk checking but does not send it; `hyperliquid.ts:69` supports only limit/IOC and reduceOnly. MCP propose_trade does not accept stops/targets/reduceOnly. The default IOC bound is ±3%, rather than the user's explicit slippage budget. Spot trade-idea exit plans are prose, not monitored orders.

Required: venue-native protective orders where available; partial-fill-aware stop sizing, OCO behavior, cancel/replace/status and reduce-only close. A dedicated deterministic exit monitor must run independently of LLM availability. Spot exits need explicit supported mechanics and outage/slippage limitations. Do not advertise guaranteed stops. Verify trigger sources, liquidation/margin data, and protection after restart.

### 6. Correct account onboarding and custody claims

`app/api/hl/connect/route.ts:21` creates a private key and `hl-sql.ts:30` overwrites the prior account on reconnect. It does not connect an existing master account or prove an approved trade-only API wallet. Reads use the same generated address. Reconnect/disconnect can discard the app's access to funded keys. Do not call an ordinary funded wallet trade-only because that is the intended use.

Required: explicit account owner address versus signing-agent address; supported master approval handshake; verify trade permissions, funding, network and revocation; idempotent provisioning; retain recoverable account history; block replacement until funds/orders are accounted for. For centralized venues, use each venue's supported OAuth or trade-only API-key flow; never request account passwords/seed phrases in chat. KYC, passkeys, 2FA and owner signatures remain owner steps. The agent can prepare and track these steps, not bypass them.

Hyperliquid documents that approved API wallets sign for a master/subaccount and that balance queries use the master/subaccount address: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets

### 7. Strengthen signing policy and isolate root authority

`turnkey.ts:33` allows any transaction addressed to listed routers, or exact unlimited-approval calldata on any token. It does not bind router function arguments such as output recipient, assets, size, chain and slippage. Router allowlisting alone does not prove funds must return to the agent: the swap function itself accepts a recipient. Application-built transactions do use the agent address; the gap is the defense if signing authority is misused.

Platform root owns suborganizations with quorum one and is available to the application for provisioning/withdrawals. Withdrawal destination changes and personal-wallet sends require only the normal session. Additive policy upgrades plus deleting one policy may leave other allowances active.

Required: separate provisioning/withdrawal authority from trading workers, decoded-transaction checks and enforceable signer policies, wallet/chain/recipient/selector/amount binding, bounded allowances or an explicit allowance policy, complete revocation, audited key rotation/recovery, and step-up authorization for transfers and destination changes. Validate effective policies on existing wallets. Turnkey documents that root quorum bypasses policies and that any remaining applicable allow can authorize: https://docs.turnkey.com/features/policies/overview

### 8. Run a durable autonomous loop

Web chat runs at most five model/tool rounds within a request (`chat/route.ts:358`). MCP serves externally initiated calls. Source search found no durable autonomous trading scheduler/worker, order/fill stream consumer or recovery service; browser refresh intervals are not these services. The existing paper-observation script is not a production trading worker and is not part of the requested rollout.

Required: persisted agent runs and checkpoints, scheduler plus market/account events, leases preventing overlapping runs, retries/backoff, dead-letter handling, provider health checks and operator alerts. Keep slow research/reselection separate from fast position protection. Bound model spend/tool calls and stop on repeated failures. Support external agents through the same service rather than relying on a particular chat remaining open.

### 9. Turn backtesting into controlled strategy selection

The repaired engine is useful, but OKX spot proxy prices do not simulate Hyperliquid funding/liquidations or historical DEX execution. On-chain history is recent and pool-dependent. Promotion compares separately fetched histories with each candidate's own symbol/window; these may not be comparable. Repeated selection against the same final 30% contaminates the holdout. `strategy-review.ts` does not pass actual initialEquity options or macro factor series in the same way as the direct backtest tool. Unknown indicators fall through to close in the resolver. Active version writes use MAX(version)+1 and separate archive/insert statements without uniqueness/transaction guarantees. A qualifying first baseline can activate even with autoPromote false.

Required: strict versioned specs, fixed immutable data windows and manifests, common benchmark/capital/cost assumptions, untouched final holdout plus walk-forward tests, trial accounting, parameter/regime stability, live venue feasibility and minimum sample rules. Include cash/no-trade and buy-and-hold baselines. Persist every trial and reason for acceptance/rejection. Default failed or stale strategies to ineligible for new risk; promotion must be atomic and permissioned. Explicitly distinguish proposed, research-qualified and live-enabled. The goal is the best validated candidate for this mandate, not a claim of the universally best strategy.

### 10. Finish accounting and production operations

New MCP coverage is candid, but `app/api/portfolio/route.ts` and chat wallet logic still omit WETH/other tokens and turn failed reads into zeros. Spot fills are not matched into complete realized/unrealized PnL; funding, network costs, cash transfers and venue balances lack a canonical reconciled ledger. Platform/model/provider costs also matter, especially for the small current bankroll.

Runtime CREATE/ALTER TABLE calls, no observed repository CI workflow, divergent legacy execution implementations and uncommitted core features make release state hard to verify. Source deployment scripts target the older API; they do not prove the newer web stack is reproducibly released. No demonstrated backup restore, production alerts, execution SLOs or incident drills.

Required: canonical assets/accounts/orders/fills/transfers/fees/funding ledger; complete paginated ingestion; exact base-unit/decimal amounts; mark timestamps and valuation coverage; net performance attribution by strategy and venue. Unify UI/chat/MCP onto this service. Introduce versioned migrations, CI/security/dependency checks, staging, immutable releases, deployment fingerprints, rollback, restore drills, RPC redundancy and operational runbooks. Review custody/product responsibilities and venue eligibility before a public launch; this audit makes no legal determination.

## Required agent tool surface

All tools should return operation ID, scope, observedAt, freshness/coverage, structured errors and retryability. Monetary inputs use decimal strings/base units; writes use idempotency keys and explicit authorization context. No secret material in model-visible responses.

| Workflow | Tools to add or unify | Completion condition |
|---|---|---|
| Discover capabilities | list_venues, list_markets, get_capabilities, get_service_health | Agent knows exactly which chain/venue supports quoting, trading, exits and accounts |
| Connect accounts | list_accounts, begin_connection, get_connection_status, verify_permissions, revoke_connection | Owner completes any required signature/authentication; server verifies restricted permissions |
| Provision/fund | provision_wallet, get_deposit_instructions, quote_funding_route, get_transfer_status | Idempotent wallet creation and verified arrival, costs and gas; transfers separately authorized |
| Observe | get_portfolio, get_open_orders, get_order, get_fills, get_funding, get_allowances | Complete, fresh, reconciled balances and exposure |
| Research | get_history, validate_dataset, create_experiment, run_backtest, compare_candidates, get_experiment | Frozen data, full costs, recorded trials, common benchmarks and honest uncertainty |
| Manage strategies | propose_strategy, qualify_strategy, activate_strategy, rollback_strategy, get_strategy_health | Research eligibility separate from permission to deploy; current version tied to each order |
| Plan execution | quote_trade, estimate_total_cost, simulate_transaction, preview_risk | Exact route, quantity, slippage/minimum output, fees, gas and resulting exposure |
| Execute/manage | submit_order, cancel_order, replace_order, close_position, set_protection | Durable idempotent lifecycle; partial fills, exits and unknown results reconciled |
| Operate | pause_entries, get_run_status, get_incidents, request_owner_action | Safe recovery and actionable notifications without requiring an open chat |

Existing analysis tools cover part of Observe/Research; existing execution tools cover only part of Execute. Account connection and comprehensive position management are the largest missing agent-facing capabilities. External account/venue selection should be driven by a capability registry, not a promise to support arbitrary accounts.

## Proposed architecture decision

Status: proposed; no implementation/deployment approval inferred from this audit.

Choose one shared trading core behind web, mobile and MCP. A Postgres-backed queue/outbox and persistent workers are a practical initial design; use a managed durable workflow service only if its operational benefits justify the added dependency. Keeping everything inside chat requests is simpler initially but cannot reliably supervise positions or recover interrupted execution.

Flow: market/account events → durable agent run → portfolio/data snapshot → research or strategy decision → deterministic risk/authorization service → order reservation → venue adapter/restricted signer → receipt/fill reconciliation → accounting and alerts. Every step is persisted and attributable to a model/spec/data/policy version. The execution service may reject an LLM plan; it must not reinterpret permission text.

Keep the root withdrawal/provisioning service isolated. A deterministic protection worker manages already-authorized exits even when the research model is down. External MCP agents use the same contracts and cannot bypass reservations or policy checks.

## Account and service setup needed

| Dependency | Current evidence | Needed for launch |
|---|---|---|
| Turnkey | Existing Base wallet and signing integration | Verify organization ownership, effective policies, root isolation, revocation and recovery |
| Hyperliquid | Client and generated-key onboarding; zero current equity | Proper owner/API-wallet connection, supported-user eligibility, permission verification and order/exit lifecycle |
| Base RPC | Public default, optional configured URL | Reliable provider(s), health/finality monitoring, request limits and reconciliation fallback |
| Postgres | Persistence exists | Controlled migrations, backup/PITR and successful restore test, leases/outbox and appropriate constraints |
| Runtime | Web/API/MCP scaffolding | Always-on workers, scheduling/events, secrets management, deployment version visibility |
| Historical/live data | Several integrations | Coverage, licenses/entitlements as applicable, freshness, archive/reproducibility and provider budgets |
| Model provider | Chat integration | Bounded research/tool budgets, model versioning, outage behavior and trace retention |
| Alerts/operations | UI activity and schema stubs | Delivered incident alerts, operator ownership and tested emergency procedures |
| Optional CEX/Solana/bridges | No complete generic execution lifecycle found | Add only through separately tested adapters and owner-authorized connection/funding flows |

No new account is necessary to finish the audit or begin software hardening. Do not create vendor accounts, incur subscriptions, import keys or move funds merely to make the platform look connected.

## Ordered implementation and acceptance gates

1. **Establish the release baseline.** Preserve/reconcile main-folder work; commit reviewed changes; document which production deployment matches which commit and connector schema. Retire or isolate legacy placeholder execution. Gate: clean reproducible build and fresh-environment migration with version reported by the running service.
2. **Close authority and custody gaps.** Token separation, explicit grants/approvals, single-use intents, restrictive signing, safe account reconnect/revocation, validated risk inputs. Gate: tests demonstrate no cross-agent/owner escalation, no manual-mode execution without approval, and no forbidden signing/transfer.
3. **Build the order and portfolio core.** Durable states, reservations, idempotency, nonce coordination, stops/cancels, fill/receipt ingestion and exact accounting. Gate: duplicate requests, timeout-after-broadcast, partial fills, reverted approvals, restarts and reorgs produce neither duplicate exposure nor invented fills. Ledger reconciles to external records.
4. **Install the worker and full tool contract.** Scheduler, leases, market/account events, protective monitor, connection workflow and incident handling. Gate: restart during each lifecycle stage recovers; model/provider failure does not abandon protection; multiple clients cannot overspend the same account.
5. **Qualify strategies at actual capital.** Freeze data/cost assumptions, record all trials, compare candidates on common periods, stress costs and regimes, separate research qualification from activation. Gate: reproducible evidence meets explicit requirements and remains economically executable after trading and service costs. No profitable candidate is a valid outcome.
6. **Validate production operations, then constrained live release.** CI, rollback, recovery drills, monitoring and end-to-end sandbox/fork/venue testnet checks as appropriate. These are software correctness tests, not a paper-trading strategy program. After the required explicit live authority, run a small real execution canary and reconcile it end to end before widening scope. No live canary was authorized or executed by this audit.

Start with Base spot as the first supported execution lane because the connected capital is there. Complete its full lifecycle before expanding venues. Build account/provider adapters so Hyperliquid and later venues reuse the same core. The architecture can support many accounts; each adapter must earn production support separately.

## Product experience to aim for

The user connects an account through a secure owner flow, sees verified capabilities and funds, and approves a clear trading mandate. The agent evaluates supported strategies, explains why one is eligible or why none is, and deploys only within that mandate. The user can see current capital, orders, protective exits, net results, data freshness, run health and the reason for every decision. Connection failures, missing funds and owner actions are surfaced as specific next steps. Pausing entries, revoking an agent and withdrawing funds are separate controls with predictable behavior.

Do not present a universal “best strategy” or an autonomous toggle as proof of readiness. The production promise should be: bounded authority, evidence-based selection, complete execution/exit tools, accurate accounting and recoverable operation.
