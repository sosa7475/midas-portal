# Midas Portal — Production Build Spec

> **Purpose.** This is the authoritative build spec for taking Midas Portal from its current MVP state
> (standalone Express backend + Expo mobile app, nothing deployed) to a **production-grade webapp on Vercel
> and a store-ready mobile app**, with a real market-analysis engine and working trade placement + monitoring.
>
> It is written to be executed by a build agent (Fable 5) in **phases**, not one monolithic pass. Each phase has
> a **Definition of Done (DoD)** and a **file-by-file task list**. Do the phases in order; later phases assume
> earlier ones are green.

---

## 0. Locked decisions

| Decision | Choice | Notes |
|---|---|---|
| Repo structure | **Turborepo monorepo; standalone API service** | `apps/api` (long-lived Node/Express service on **Fly.io**) is the one backend; `apps/web` (Next.js App Router on **Vercel**) is the UI + landing and calls `apps/api`; `apps/mobile` (Expo) calls the same API; `packages/shared` holds types + zod schemas. Migrate the existing `backend/` into `apps/api`. |
| Market analysis source | **Direct provider APIs, exposed as MCP-shaped LLM tools** | Backend calls Orderly public + Crypto.com / CoinDesk / FMP REST/WS directly. Tool schemas are MCP-compatible so real MCP servers can be swapped in later without changing the agent loop. |
| Exchange | **Orderly Network (perps)** | Real ed25519 signing + account registration required (current HMAC impl is wrong). |
| LLM | **Provider-agnostic (OpenAI / Anthropic)** via existing adapter | Keep BYO-key support; default provider via env. Prefer latest Claude models for the agent loop. |
| Deployment | **Fly.io** (backend API — one long-lived Node service), **Vercel** (web UI + landing), **EAS/TestFlight** (mobile), **Neon** (Postgres), **Upstash** (Redis/rate-limit/cache), **S3 or Fly volume** (uploads) | One backend on Fly, shared by web and mobile. |
| Design language | **Glassmorphism + agentic web3 trading aesthetic** | Dark-first, translucent glass surfaces, subtle gradients/glow, motion, "agent is thinking/acting" transparency. Shared token system across web + mobile. |
| Security | **Top priority, non-negotiable** | See §5. Every phase's DoD includes its security checks; nothing ships that fails them. |

### Hosting topology
- **Backend (`apps/api`) → Fly.io.** A single long-lived Node/Express process. Because it's persistent (not serverless), the following are **native and require no workarounds**: real token-by-token **SSE streaming**, a **persistent server-side WebSocket to Orderly** for fills/positions/prices, in-process schedulers for reconciliation, and normal process lifecycle. Run ≥1 always-on machine; scale horizontally later.
- **Frontend (`apps/web`) → Vercel.** Next.js App Router serves the marketing landing (public) and the authed app UI, calling `apps/api` over HTTPS. Vercel gives edge CDN + preview deploys for the frontend.
- **Mobile (`apps/mobile`) → EAS build → TestFlight** (iOS) and Play internal track (Android), calling the same `apps/api`.
- **CORS:** `apps/api` allows only the Vercel web origin(s) + the mobile app; no wildcard with credentials.
- **State:** even though a long-lived server *could* keep sessions in memory, keep agent/session state in Postgres/Upstash so restarts and multi-machine scaling stay correct (see Phase 1).

> Note: moving the backend off serverless resolves most of the "serverless-fatal" defects in §1 by construction (SSE, persistent WS, filesystem, cron). Phase 1 still hardens statefulness and uploads for **multi-instance** correctness, and fixes the non-hosting bugs (status enum, PnL, crypto, Orderly signing).

### External prerequisites the build agent cannot self-provision
These must be supplied as env/secrets before the relevant phase can be verified:
- Orderly **broker id**, account registration flow + **orderly ed25519 key** material, and the official Orderly API signing reference.
- Market-data API keys: Crypto.com Exchange, CoinDesk, FMP.
- LLM keys (OpenAI and/or Anthropic).
- **Fly.io** account + `flyctl` auth token, app name, and region; **Vercel** project for `apps/web`.
- Neon `DATABASE_URL`, Upstash Redis URL/token, object storage (S3 bucket creds or a Fly volume) for uploads.
- Apple Developer + Google Play accounts and an EAS `projectId` for TestFlight / Play submission.

---

## 1. Current-state inventory (what exists / what's broken)

### Exists
- **Backend** (`backend/src/`, ~1,100 LOC): Express monolith. Routes: `auth`, `wallet`, `strategy`, `trade`, `chat`, `settings`. Postgres schema (`users`, `strategies`, `trades`, `api_keys`, `conversations`). LLM adapter (OpenAI/Anthropic, vision + tool scaffolding). In-memory agent session manager. Orderly REST wrapper. Configured for Vercel via `backend/vercel.json` but **never deployed**.
- **Mobile** (`mobile/`, ~1,760 LOC): Expo Router, 5 tabs (Chat, Portfolio, Strategy, Journal, Settings), Zustand store, theme system, glass UI components.

### Does NOT exist
- Any **web app**.
- Any **market-analysis / MCP** integration (agent is single-shot, market-blind).
- Real-time monitoring, PnL computation, positions, push notifications.
- Tests, CI/CD, observability, versioned migrations, shared types.

### Must-fix defects (see Phase 1)
**Hosting-related (mostly resolved by moving to Fly — but still fix for multi-instance correctness; do NOT reintroduce serverless assumptions):**
1. In-memory agent session store (`sessions = new Map()` in `session-manager.js`) — breaks across restarts and multiple Fly machines. Move to DB/Upstash.
2. Disk file uploads (`multer` disk storage + `fs` + `mkdirSync('./uploads')`) — not durable across machines/redeploys. Use S3/Fly volume.
3. Fake SSE streaming in `routes/chat.js` — computes full response then writes once. On Fly, implement **real** token streaming.
4. In-memory `express-rate-limit` store — per-machine only. Use the Upstash store so limits hold across machines.
5. `app.listen()` is correct for Fly (long-lived) — just ensure clean shutdown handling.

**Correctness:**
6. `orderly.placeOrder` returns `status: 'submitted'`, which violates the `trades` CHECK constraint (`pending|confirmed|filled|cancelled|rejected`) — insert fails on success.
7. `pnl` never computed → dashboard win-rate divides by zero → `NaN%`.
8. Orderly auth uses HMAC-SHA256 as `orderly-account-id`; real Orderly requires ed25519 orderly-key signing + a registered account id → live calls 401.
9. SL/TP algo orders have no OCO linkage — TP fill doesn't cancel SL.
10. AES-256-**CBC** with a default all-zero `ENCRYPTION_KEY` and no integrity tag.

**Mobile-fatal:**
11. `streamChat` uses `res.body.getReader()` — unsupported by React Native fetch.
12. `uuidv4()` throws in RN without `react-native-get-random-values`.
13. No EAS `projectId`, placeholder icons/splash.

---

## 2. Target architecture

```
midas-portal/ (Turborepo)
├─ apps/
│  ├─ api/                  # Node/Express long-lived service → Fly.io (THE backend)
│  │  ├─ src/routes/        # auth, chat (SSE), strategy, trade, wallet, market, positions
│  │  ├─ src/agent/         # agentic tool-use loop
│  │  ├─ src/ws/            # persistent Orderly WebSocket listener
│  │  ├─ src/jobs/          # in-process reconciliation scheduler
│  │  └─ fly.toml, Dockerfile
│  ├─ web/                  # Next.js App Router → Vercel (UI + landing, calls apps/api)
│  │  ├─ app/(marketing)/   # landing, legal (ToS, privacy, risk disclaimer)
│  │  └─ app/(app)/         # authed: chat, portfolio, strategy, journal, markets, settings
│  └─ mobile/               # Expo Router app (migrated from ./mobile)
├─ packages/
│  ├─ shared/               # zod schemas, TS types, API client, design tokens (single source of truth)
│  ├─ analysis/             # market data providers + indicators + agent tools (MCP-shaped)
│  ├─ exchange/             # Orderly: ed25519 signing, onboarding, orders, WS, risk engine
│  └─ agent/                # system prompts, agentic tool-use loop, trade parsing
├─ db/                      # versioned migrations (drizzle or node-pg-migrate)
└─ turbo.json
```

- **API** is the single `apps/api` service on Fly. Web + mobile both call it. **SSE streaming** and the **persistent Orderly WebSocket** run in-process (no serverless workarounds).
- **Agent loop** (`packages/agent`) is a real tool-use loop: LLM ↔ tools from `packages/analysis` + `packages/exchange`, grounded in the user's strategy and live market data.
- **Monitoring** via a persistent server-side Orderly WebSocket in `apps/api/src/ws` + an in-process reconciliation scheduler (`apps/api/src/jobs`) writing authoritative state to Postgres.

---

## 3. Phased plan

### Phase 1 — Foundation, deploy, & defect fixes
**Goal:** monorepo scaffold, shared contracts, versioned DB, backend deployed to Fly, and every §1 defect fixed. Backend is stateful-server-correct (safe across restarts + multiple machines).

Tasks:
- Scaffold Turborepo; move `backend/` into `apps/api` (keep Express); move `mobile/` to `apps/mobile`; scaffold `apps/web` (Next.js).
- Add `apps/api/Dockerfile` + `fly.toml`; deploy to Fly with ≥1 always-on machine; wire Neon + Upstash + object storage; health check.
- Create `packages/shared`: zod schemas + TS types for every API request/response + design tokens; a typed API client used by web and mobile.
- Replace `schema.sql` blob with **versioned migrations** (`db/`); add `positions`, `fills`, `alerts`, `strategy_versions`, `risk_limits` tables (fleshed out in later phases; stub now).
- Restart-safe agent: delete `sessions = new Map()`; load strategy + recent history from DB per request (optionally cache in Upstash keyed by userId with TTL) so any machine can serve any request.
- File uploads: stream to **S3/Fly volume** via object-storage client; don't rely on ephemeral local disk for durable data.
- Rate limiting: Upstash Redis store (shared across machines); strict limits on auth + order endpoints.
- Fix status enum bug (map Orderly statuses → allowed set, or widen the CHECK).
- Crypto: AES-256-**GCM**, required non-default `ENCRYPTION_KEY` (fail fast if missing/default).
- Real SSE: `apps/api` streams token-by-token (native on Fly — no fake single-write).
- Mobile: add `react-native-get-random-values` polyfill; replace `streamChat` with `react-native-sse`/XHR transport.

**DoD:**
- `pnpm build` + typecheck green across all packages.
- `apps/api` **deployed on Fly**; `/health` returns ok on the public Fly URL; `apps/web` deployed on Vercel and reaching the Fly API through the CORS allowlist.
- Register → login → define strategy → **streaming** chat → screenshot upload all succeed against the deployed Fly API.
- Trade insert succeeds with a real Orderly (testnet) order without CHECK violation.
- Agent state survives an `apps/api` restart; a second Fly machine serves requests identically (no in-memory session dependence).
- **Security:** `ENCRYPTION_KEY`/`JWT_SECRET` required & non-default; secrets in Fly secrets (not repo); CORS allowlist enforced; GCM in use.

### Phase 2 — Analysis engine (the "MCPs")
**Goal:** the agent can see the market. Real agentic tool-use loop grounded in live data.

Tasks (`packages/analysis`):
- Provider clients: Orderly public (candles, orderbook, funding, OI, mark/index), Crypto.com Exchange (ticker, candles, orderbook, trades), CoinDesk (indices/news), FMP (fundamentals/news). Each behind a normalized interface with caching (Upstash) + rate-limit handling.
- `compute_indicators`: RSI, MACD, EMA/SMA, ATR, VWAP, Bollinger, support/resistance, from OHLCV.
- Expose all of the above as **MCP-shaped tool definitions** (name, description, JSON schema) — see table in the analysis package README.
- `packages/agent`: implement the real **tool-use loop** — the LLM may call tools, backend executes them, results feed back until a final answer. Wire `tools` through `llm-adapter.chat` (currently the adapter supports tools but `session-manager` never passes any — dead path).
- Ground the system prompt in: user strategy rules + live account state (for sizing) + tool outputs.

**DoD:**
- Given "should I long BTC here?", the agent demonstrably calls ≥2 market tools (visible in a trace/log) and returns a recommendation citing real numbers (price, ATR-based stop, funding).
- Screenshot analysis is corroborated with live data for the same pair.
- Tool schemas validate; each provider client has unit tests with recorded fixtures.
- Swapping a provider client for a real MCP server would require no change to `packages/agent`.

### Phase 3 — Trade placement & monitoring
**Goal:** real orders, real-time monitoring, enforced risk discipline.

Tasks (`packages/exchange`):
- **Correct Orderly integration:** ed25519 orderly-key signing, account registration/onboarding flow, instrument metadata (symbol format, tick/lot precision, rounding), OCO-linked SL/TP.
- **Risk engine** (server-side, pre-trade): max position size, max leverage, max daily loss, per-trade risk %; reject or resize before sending. This is the enforced "emotional discipline," not prompt text.
- **Monitoring:** a **persistent server-side Orderly WebSocket** in `apps/api/src/ws` (native on Fly) for fills/positions/mark price → persist `fills`, maintain `positions`, compute realized + unrealized PnL, update `trades.status`. Auto-reconnect with backoff.
- **In-process reconciliation scheduler** (`apps/api/src/jobs`, runs every ~30–60s + on-demand after a trade): sync open orders/positions, backfill PnL, close journal entries — authoritative even if a WS event is missed.
- New endpoints + shared types: `GET /positions`, `GET /trade/:id` (live), fills stream/poll.

**DoD:**
- Place a testnet market order with SL+TP; verify OCO (TP fill cancels SL) on Orderly.
- Positions endpoint returns live size/entry/mark/uPnL/liq price.
- Risk engine blocks an over-sized order in a test and logs the reason.
- Cron job updates a filled trade's realized PnL without user interaction; win-rate no longer `NaN`.

### Phase 4 — Web app (Next.js on Vercel)
**Goal:** full-featured webapp at parity with mobile plus web-native strengths.

Tasks (`apps/web`):
- Auth pages (register/login/reset/verify), JWT + refresh, protected layout.
- **Chat**: true token streaming (Edge SSE), chart image upload + drag-drop, trade-recommendation cards with Confirm/Reject, tool-call transparency.
- **Strategy** editor (NL + parsed JSON, versioning).
- **Portfolio**: live balance, positions, equity curve, PnL (real charts — follow the `dataviz` skill).
- **Journal**: filters, analytics (win rate, R:R, drawdown, expectancy), CSV export.
- **Markets**: live candles/orderbook widgets from `packages/analysis`.
- **Settings**: LLM keys, Orderly connect/onboard, risk limits, theme.
- **Full landing page** (hero, product narrative, live-looking demo, feature sections, security/trust callouts, pricing if any, legal footer) — beautiful, fast, glass/web3 aesthetic per §4. This is the public front door.
- **Legal** (risk disclaimer, ToS, privacy) — mandatory for a trading product.
- Glassmorphism design system (§4) applied throughout; responsive + light/dark, accessible.

**DoD:**
- Every mobile flow has a working web equivalent, all hitting the same shared API.
- Chat streams token-by-token in the browser with visible agent tool-call activity.
- Landing page renders beautifully on mobile + desktop; Lighthouse perf/a11y/best-practices ≥ 90 on landing + app shell.
- Deployed to a Vercel production URL; app behind auth, landing public.
- **Security:** CSP/HSTS/CORS allowlist enforced; no secrets in client bundle; auth-gated routes verified server-side.

### Phase 5 — Mobile hardening & store submission
**Goal:** store-ready builds.

Tasks (`apps/mobile`):
- Consume `packages/shared` types/client (kill duplicated API code).
- `expo-notifications` for fills/price alerts; register push tokens server-side.
- Set `extra.eas.projectId`, owner; real icons/splash/store screenshots.
- Biometric app-lock (`expo-local-authentication`); token in secure-store; error boundaries; offline handling.
- Live positions/prices via WS.
- EAS build + submit pipelines; **`eas submit` to TestFlight** (iOS) and Play internal track (Android); financial-app review notes.
- Point the app at the production Fly API; glassmorphism design system (§4) applied.

**DoD:**
- `eas build --profile production --platform all` succeeds and **the iOS build is live on TestFlight** (installable by testers).
- Push notification delivered on a real device when a testnet order fills.
- On-device build completes register→strategy→analyze→confirm trade→journal against the production API.
- **Security:** biometric app-lock works; token in secure-store; no secrets in the JS bundle.

### Phase 6 — Production hardening
**Goal:** observability, tests, CI/CD, compliance.

Tasks:
- Sentry (web + mobile + API), structured logging, uptime/health checks.
- Test suites: unit (indicators, Orderly signing, risk engine, crypto), integration (route handlers), e2e (Playwright web, Maestro/Detox mobile). Target meaningful coverage on `packages/analysis`, `packages/exchange`, `packages/agent`.
- GitHub Actions: typecheck + lint + test on PR; **deploy `apps/api` to Fly** + `apps/web` to Vercel on merge to main; EAS build/submit on release tag.
- Secrets management + `ENCRYPTION_KEY` rotation plan; staging vs prod envs.
- Compliance pass: disclaimers, no-financial-advice framing, jurisdiction/geo + KYC review as a go-to-market gate.

**DoD:**
- CI green on PR; preview deploy auto-created.
- Errors surface in Sentry with source maps.
- Documented runbook: deploy, rotate keys, roll back, on-call for stuck orders.

---

## 4. Design system (glassmorphism · agentic web3)
One shared visual language across web and mobile, so the two feel like one product.

- **Foundation:** dark-first (light theme supported), deep near-black backgrounds with layered **translucent glass** surfaces (`backdrop-blur`, subtle inner/outer borders, soft shadows), restrained neon/gradient accents and glow on interactive/live elements. Extend the existing mobile palette (`mobile/src/theme`) into shared tokens in `packages/shared` (color, radius, spacing, blur, elevation, typography) consumed by both apps.
- **Agentic transparency:** the app should *feel* like an agent is working — show tool calls as they happen ("fetching BTC orderbook…", "computing ATR…"), streamed reasoning, and a clear "agent proposed → you confirm" gate before any order. Never place a trade without an explicit user confirm.
- **Trading polish:** live-updating numbers with directional color (profit/loss), animated equity curve, orderbook/candle widgets, position tiles with uPnL glow. All charts follow the `dataviz` skill — one coherent, accessible chart system in light and dark.
- **Landing page:** full marketing landing (hero, product story, live-looking demo, feature sections, trust/security callouts, legal footer) in the same glass/web3 aesthetic — this is the front door, must be beautiful and fast.
- **Motion:** purposeful (reanimated on mobile, Framer-Motion-style on web) — entrance, streaming text, value transitions, confirm/execute feedback. No gratuitous animation.

## 5. Security (highest priority — gates every phase)
Security is the top requirement. No phase is "done" until its security checks pass. Baseline for the whole system:

- **Secrets/keys:** AES-256-**GCM** for all stored user secrets (Orderly + LLM keys); required non-default `ENCRYPTION_KEY` and `JWT_SECRET` (fail fast if missing/default). Documented key-rotation path. Never log or return secret values.
- **Auth:** short-lived access JWT + rotating refresh tokens with server-side revocation; bcrypt (cost ≥ 12); email verification + password reset; optional TOTP 2FA; biometric app-lock on mobile.
- **Transport/headers:** HTTPS only, strict CORS allowlist (no `*` with credentials), Helmet/CSP, HSTS.
- **Input:** validate **every** request with zod; parameterized SQL only (already the case — keep it); size/type limits on uploads; reject unexpected fields.
- **Abuse:** Upstash-backed rate limiting per-IP and per-user; stricter limits on auth + order endpoints; idempotency keys on order placement.
- **Trading-specific:** server-side risk engine is a hard gate (max size/leverage/daily-loss) that the client cannot bypass; all orders require explicit user confirmation; full audit log of every order + agent decision.
- **Least privilege:** Orderly keys scoped to trading (no withdrawals) where possible; separate staging/prod secrets; principle-of-least-privilege DB role.
- **Supply chain:** pinned deps, `pnpm audit`/Dependabot in CI, no untrusted postinstall.
- **Observability of abuse:** Sentry + structured audit logs; alerts on auth anomalies and repeated order rejections.

**Per-phase security DoD:** each phase below inherits these; the phase DoD lists the specific checks that must be green for that phase.

## 6. Cross-cutting conventions
- **Single source of truth:** all API contracts as zod schemas in `packages/shared`; infer TS types from them; validate every request/response.
- **No secrets in code;** all via env. Fail fast if `ENCRYPTION_KEY`/`JWT_SECRET`/provider keys are missing or default.
- **Runtime split:** streaming chat on Edge; DB/crypto/order placement on Node.
- **Idempotency** on order placement (client-supplied key) to survive retries.
- **Every external call** (LLM, Orderly, market data) wrapped with timeout, retry-with-backoff, and typed error mapping.

## 7. What to hand Fable 5 per phase
For each phase, provide: this spec section, the resolved external prerequisites for that phase (§0), and the phase's DoD as explicit acceptance tests. Run phases as **separate sessions** — Phase 2 (agentic loop) and Phase 3 (Orderly signing) each require verification against live/testnet endpoints and should not be blindly chained behind unverified earlier work.
