# Phase 4 — Web app (Next.js on Vercel)

**Read first:** `BUILD_SPEC.md` §3 (Phase 4), §4 (design), §5 (security). **Prerequisite:** Phase 3 DoD green. Follow the `dataviz` skill for all charts.

## Scope
A full-featured, beautiful web app + landing page on Vercel, at parity with mobile, all hitting the Fly API. Glassmorphism / agentic web3 aesthetic (BUILD_SPEC §4).

## Tasks
- [ ] Auth pages (register/login/reset/verify), JWT + refresh, protected app layout.
- [ ] **Chat**: true token streaming (SSE), chart image upload + drag-drop, trade-recommendation cards (Confirm/Reject), visible agent tool-call activity.
- [ ] **Strategy** editor (NL + parsed JSON, versioning).
- [ ] **Portfolio**: live balance, positions, equity curve, PnL (real charts via `dataviz`).
- [ ] **Journal**: filters, analytics (win rate, R:R, drawdown, expectancy), CSV export.
- [ ] **Markets**: live candles/orderbook widgets from `packages/analysis`.
- [ ] **Settings**: LLM keys, Orderly connect/onboard, risk limits, theme.
- [ ] **Full landing page**: hero, product narrative, live-looking demo, feature sections, security/trust callouts, legal footer — beautiful + fast, glass/web3.
- [ ] **Legal**: risk disclaimer, ToS, privacy.
- [ ] Glass design system applied throughout; responsive + light/dark; accessible.

## Definition of Done
- [ ] Every mobile flow has a working web equivalent, all hitting the shared Fly API.
- [ ] Chat streams token-by-token in the browser with visible tool-call activity.
- [ ] Landing renders beautifully on mobile + desktop; Lighthouse perf/a11y/best-practices ≥ 90 on landing + app shell.
- [ ] Deployed to a Vercel production URL; app auth-gated, landing public.
- [ ] Security: CSP/HSTS/CORS allowlist enforced; no secrets in client bundle; auth-gated routes verified server-side.

**Stop when green.** Report the production URL and blockers for Phase 5.
