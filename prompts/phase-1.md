# Phase 1 — Foundation, deploy, & defect fixes

**Read first:** `BUILD_SPEC.md` §0–§2, §3 (Phase 1), §4–§6. This brief is a checklist; the spec is the detail.

## Scope
Stand up the monorepo, migrate the existing backend/mobile in, ship the backend to Fly and the web shell to Vercel, and fix every defect in BUILD_SPEC §1. No feature work beyond making the existing flows correct and deployed.

## Tasks
- [ ] Scaffold Turborepo: `apps/api`, `apps/web`, `apps/mobile`, `packages/shared`, `db/`.
- [ ] Migrate `backend/src/**` → `apps/api` (keep Express); migrate `mobile/**` → `apps/mobile`; scaffold `apps/web` (Next.js App Router, glass design shell).
- [ ] `packages/shared`: zod schemas + inferred TS types for **every** API request/response; typed API client; design tokens (from `mobile/src/theme`). Web + mobile import these.
- [ ] `db/`: versioned migrations replacing `schema.sql`; add stub tables `positions`, `fills`, `alerts`, `strategy_versions`, `risk_limits`.
- [ ] `apps/api/Dockerfile` + `fly.toml`; deploy to Fly (≥1 always-on machine); wire Neon + a Fly upload volume; `/health` endpoint.
- [ ] Restart-safe agent: remove `sessions = new Map()`; load strategy + history from DB per request.
- [ ] Uploads → S3/Fly volume (not ephemeral disk).
- [ ] Rate limiting → Postgres-backed store (no Redis); strict on auth + order routes.
- [ ] Fix status-enum bug (Orderly status → allowed set, or widen CHECK).
- [ ] Crypto → AES-256-GCM; require non-default `ENCRYPTION_KEY` + `JWT_SECRET` (fail fast).
- [ ] Real token-by-token SSE in `apps/api` chat route.
- [ ] Mobile: `react-native-get-random-values` polyfill; replace `streamChat` with `react-native-sse`/XHR.
- [ ] Deploy `apps/web` to Vercel pointing at the Fly API; CORS allowlist = web origin(s) + mobile.

## Definition of Done (all must be verifiably true)
- [ ] `pnpm build` + typecheck green across all packages.
- [ ] `apps/api` live on a public Fly URL; `/health` ok; `apps/web` on Vercel reaching it via CORS allowlist.
- [ ] End-to-end against the deployed Fly API: register → login → define strategy → **streaming** chat → screenshot upload all succeed.
- [ ] Orderly **testnet** trade insert succeeds without the status-enum CHECK violation.
- [ ] Agent state survives an `apps/api` restart; a second Fly machine serves requests identically.
- [ ] Security: secrets in Fly secrets (not repo); `ENCRYPTION_KEY`/`JWT_SECRET` required & non-default; GCM in use; CORS allowlist enforced.

**Stop when green.** Report deployed URLs, what you verified, and blockers for Phase 2.
