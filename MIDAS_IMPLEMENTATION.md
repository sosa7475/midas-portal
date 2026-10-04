# Agentic trading implementation — October 4, 2026

This worktree contains the newer uncommitted web implementation copied from the main checkout plus the controls below. The main checkout was not edited. No production migration, deployment, policy upgrade, schedule activation, live order or fund movement was performed. A temporary local PostgreSQL database was used for integration tests.

## Implemented controls

- Trading control supports Base and Robinhood Chain (4663) wallet views, exact-amount proposals, owner approval/rejection, durable order status, bounded mandates, schedules and approved Hyperliquid API-wallet connection. Robinhood Chain is an Arbitrum chain with ETH gas; quotes use its deployed Uniswap contracts. This does not provide Robinhood brokerage trading or automatic bridging.
- Orders are durable before dispatch. Transaction hashes are saved before broadcast; uncertain submissions retain account reservations and are never automatically resent. Submitted or anomalous EVM fills retain reservations too. Recorded receipts and venue client-order IDs support reconciliation. Approval-only recovery requires recent owner authentication and canonical receipt evidence; it cannot release an unknown swap.
- Revocable mandates constrain venues, assets, version, expiry, slippage, order value and reserved daily turnover. Fresh qualifying held-out strategy evidence is checked both at reservation and before signing. Missing measurements block configured loss limits. Outstanding perpetual positions, orders and recent reservations contribute to exposure checks.
- Autonomous spot purchases require owner-defined stop/target and maximum holding time. Actual received tokens determine exit quantity. Fill status and attached exit persist in one transaction; reconciliation repairs delayed fills. New protected purchases stop when the exit-monitor heartbeat is stale. Protective exits bypass entry pauses but retain their exact authorization, balance, gas and slippage checks. Existing holdings can receive separate owner-created rules.
- Spot protection is an off-chain polling service, not a guaranteed stop. Time exits have a five-minute authorization grace window; failed or expired exits alert the owner and may leave holdings open. Thresholds are proceeds in the entry token, not total USD portfolio losses. Fees are separate. Pyramiding into an asset with an active exit rule is blocked.
- Hyperliquid supports verified trade API wallets, cancellation, reduce-only closes and native protective orders. Reconciliation records partial fills and checks protective child orders; missing protection on an open position alerts and pauses new entries. Existing funded credentials are preserved on reconnect.
- EVM approvals are exact amount. Fee checks cover execution plus estimated L1/operator components where applicable; Robinhood/Arbitrum gas estimates include their data component. Receipts preserve unknown fee components rather than treating them as zero. Estimates cannot guarantee future network fees. Unsupported transfer-tax/rebasing behavior can lead to review-required status.
- Research runs, exit checks, reconciliation and alert delivery have separate loops. Research runs use persistent leases; stale runs and revoked connector permissions cannot sign. Heartbeat endpoint `/api/health/worker` returns 503 when required loops are stale. Owner alerts are durable, deduplicated and acknowledged in Trading control. Optional signed HTTPS webhook delivery uses retries, delivery leases and revision idempotency.
- Sessions are database-backed and revocable on logout/password reset. Sensitive owner actions require recent password verification. OAuth codes are one-time; refresh tokens rotate and replay revokes the family. Connector revocation revokes its family. Tokens have enforced expiry, agent scope and read/research/propose/execute permissions; execution is opt-in.
- MCP uses bearer headers, central schema validation, bounded requests, Origin validation and a tested stateless JSON Streamable HTTP transport. The checked-in `mcp-catalog.json` and `/api/mcp/catalog` expose the same versioned 33-tool catalog. CI detects catalog drift. Research/proposal permission does not authorize live execution.
- Robinhood asset search no longer matches every branded token. Moralis receives normalized chain IDs and validates contracts; supported token-price failures have a labelled GeckoTerminal fallback. Missing Finnhub credentials produce a labelled underlying-quote fallback where available; fundamentals remain unavailable.
- Readiness reports disclose blockers. Receipt-backed FIFO accounting preserves exact integers and reports unmatched lots, unknown opening basis and missing fees. It is explicitly incomplete, rather than presenting an invented total P&L.

## Verification

- 94 server unit/route tests pass, including MCP protocol/scopes/schema errors, data-provider fallback, exit boundaries, partial fills, fee components, FIFO limitations, authorization and replay checks.
- Real PostgreSQL 16 integration test passes with migrations 0004 and 0005. It exercises concurrent requests with one dispatch, cross-tenant rejection, unknown-submission locking, actual-sized attached exits, atomic fill persistence and rollback on incomplete evidence, duplicate replay, stale-monitor entry blocking, logout revocation, and refresh-token replay family revocation.
- Web TypeScript checks and the production Next.js build pass. CI targets Node 24 and PostgreSQL 16. Local verification used the available Node runtime.
- Read-only connected-provider checks were performed. No venue order was submitted. No browser journey, long-running paper session, external webhook delivery, full restore drill, or live Turnkey policy acceptance test was performed.

## Live versus local

The connected Midas service exposes 18 older tools; local source now exposes 33. These source changes do not update that connector by themselves. The active Vercel project was identified as `web` (`prj_4vbIanE2kwAwJUeQnzIUIBPYW1f5`), not the older `midas-portal-api` project. Only environment-variable names/metadata were inspected. Finnhub and worker alert configuration were absent. Hyperliquid read-only observations showed an empty testnet account. The observed active strategy had negative held-out results and must not become eligible merely because it was already marked active.

## Rollout procedure

1. Review all worktree changes, including imported uncommitted source. Back up the existing database and prove restoration separately. Install locked dependencies with Node 24.
2. Preserve existing encryption keys. Supply database TLS configuration, a strong JWT secret and existing Turnkey credentials through secret storage. Keep automatic execution disabled. Session changes require login again; connector changes require reauthorization with explicit scopes.
3. Apply `pnpm --filter @midas/web migrate:control` before deploying the web app or workers. It applies migrations 0004/0005 transactionally. Do not remove execution evidence during rollback. Existing legacy application tables are prerequisites. Resolve any pre-existing conflicting in-flight accounts before replacing the unique index; do not delete uncertain orders to make migration pass.
4. Validate Turnkey policy construction in a staging organization, including allowed swaps and rejection of wrong recipients/chains/selectors/transfers. Only then upgrade existing production policies and remove permissive predecessors. Root withdrawals remain disabled by default.
5. Deploy the web app to the correct project, publish/refresh the MCP connector from the checked catalog, and verify initialize, scoped tools/list, representative reads, denied execution and token revocation against that deployment.
6. Deploy `deploy/worker.Dockerfile` as a persistent supervised service with the same database, encryption and signer configuration, plus OPENAI_API_KEY. Configure an external uptime monitor for `/api/health/worker`. Optional MIDAS_ALERT_WEBHOOK_URL must be HTTPS and MIDAS_ALERT_WEBHOOK_SECRET at least 32 characters. No webhook means in-app alerts only. `worker -- --once` can trade authorized orders; it is not a health check.
7. Add Finnhub credentials securely if company fundamentals are required. Verify provider entitlements and chain-specific funding. Robinhood Chain requires funds on chain 4663; Ethereum/Base balances do not fund it automatically. Hyperliquid requires an owner-approved mainnet API wallet for production.
8. Exercise timeout/restart, partial fills, rejected protection, pause/revocation, RPC outage, insufficient gas and uncertain-submission recovery in staging. Complete an owner-controlled minimal live acceptance separately. Qualify a strategy, then enable a narrow expiring mandate and schedule.

## Still unresolved before unattended production capital

These are real remaining requirements, not completed checks:

- Deployed policy verification, independently reviewed custody/auth boundaries, separate root/withdrawal service isolation, complete account replacement/recovery procedures, and a restore drill.
- Full wallet indexing, imported opening balances/transfers, cross-currency cost basis, historical fees and portfolio-wide equity/drawdown/concentration limits. The new FIFO tool covers verified Midas fills only. Do not use it as complete tax accounting or a full portfolio loss budget.
- Long-running venue acceptance and failure tests, monitor capacity/failover under load, actual webhook/uptime delivery and continuously observed paper/live behavior. Spot exits depend on liquidity, gas, reachable providers and the monitor. Current batches are bounded; throughput and latency must be load-tested before scaling accounts.
- Fee-on-transfer/rebasing token support and a hard guarantee on future total L2 fees are not implemented. Such guarantees should not be advertised.
- A defensible out-of-sample trading edge. Repeated backtest searches can overfit. No implementation can guarantee a best or profitable strategy.

## Incident response

Pause schedules, revoke mandates and pause new entries. Separately authorized exits and cancellations remain available. Revoke compromised venue API approvals and disable local connections. Stop signer processes for a custody incident. Preserve keys, orders, nonce history, snapshots and audit logs. Reconcile recorded transaction/client IDs before releasing a reservation; never replay an ambiguous trade. Escalate expired or failed exits promptly because the position can remain open.
