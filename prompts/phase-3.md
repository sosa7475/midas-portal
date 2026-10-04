# Phase 3 — Trade placement & monitoring

**Read first:** `BUILD_SPEC.md` §3 (Phase 3), §5 (security). **Prerequisite:** Phase 2 DoD green. **Needs:** real Orderly testnet account/broker + official signing docs.

## Scope
Real orders on Orderly with correct auth, a hard server-side risk engine, and real-time monitoring via a persistent WebSocket (native on Fly) + reconciliation.

## Tasks
- [ ] `packages/exchange`: correct Orderly integration — **ed25519 orderly-key signing** (replace the wrong HMAC), account registration/onboarding flow, instrument metadata (symbol format, tick/lot precision, rounding), **OCO-linked SL/TP** (TP fill cancels SL).
- [ ] **Risk engine** (server-side, pre-trade hard gate): max position size, max leverage, max daily loss, per-trade risk %. Reject/resize before sending; client cannot bypass. Log every decision.
- [ ] `apps/api/src/ws`: persistent Orderly WebSocket (auto-reconnect w/ backoff) → persist `fills`, maintain `positions`, compute realized + unrealized PnL, update `trades.status`.
- [ ] `apps/api/src/jobs`: reconciliation scheduler (~30–60s + on-demand after a trade) — authoritative even if a WS event is missed.
- [ ] Endpoints + shared types: `GET /positions`, live `GET /trade/:id`, fills stream/poll. Idempotency key on order placement.

## Definition of Done
- [ ] Place a **testnet** market order with SL+TP; verify OCO on Orderly (TP fill cancels SL).
- [ ] `/positions` returns live size/entry/mark/uPnL/liq price.
- [ ] Risk engine blocks an over-sized order in a test and logs the reason.
- [ ] Reconciliation updates a filled trade's realized PnL without user interaction; win-rate no longer `NaN`.
- [ ] Security: Orderly keys scoped to trading (no withdrawals) where possible; every order requires explicit user confirmation; full audit log of orders + agent decisions; idempotency prevents double-submit on retry.

**Stop when green.** Report a verified testnet trade lifecycle and blockers for Phase 4.
