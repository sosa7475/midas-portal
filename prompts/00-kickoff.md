# Fable 5 Kickoff — Midas Portal

You are building **Midas Portal**, an agentic web3 crypto perp-trading app: a Fly.io-hosted backend shared by a Vercel-hosted Next.js web app (with a full landing page) and an Expo mobile app (TestFlight). The full plan lives in **`BUILD_SPEC.md`** at the repo root — it is authoritative.

## Before writing any code
1. **Read `BUILD_SPEC.md` end to end**, then read `prompts/phase-1.md`.
2. Read the current code so you migrate rather than rewrite: `backend/src/**` (the existing Express API) and `mobile/**` (the existing Expo app).
3. Confirm which **external prerequisites** from BUILD_SPEC §0 you have (Fly token, Neon `DATABASE_URL`, LLM keys, Orderly testnet broker/account + signing docs). If any needed for Phase 1 are missing, list exactly what you need and stop — do not fake them.

## How to work
- **Execute Phase 1 only** in this session (foundation, monorepo, Fly deploy, defect fixes). Do not start Phase 2+.
- Security is the #1 priority (BUILD_SPEC §5). Every task inherits those checks.
- Hosting is **locked**: backend = one long-lived Node service on **Fly.io** (persistent process — real SSE and persistent WebSockets are native; do NOT reintroduce serverless workarounds). Web + landing = **Vercel**. Mobile = **EAS/TestFlight**. One backend only.
- Preserve existing working logic where correct; fix the defects listed in BUILD_SPEC §1.
- Use `packages/shared` (zod + types) as the single source of truth for API contracts — web and mobile both import it.

## Definition of Done for this session
Phase 1 is complete only when every checkbox in the **Phase 1 DoD** (BUILD_SPEC §3) is verifiably green — including: `apps/api` deployed and healthy on a public **Fly URL**, `apps/web` on Vercel reaching it through the CORS allowlist, streaming chat working, agent state surviving a restart, and the Orderly testnet trade insert succeeding without the status-enum bug.

When Phase 1's DoD is green, **stop and report**: what's deployed (URLs), what's verified, and any blockers for Phase 2. Do not proceed to Phase 2 without a fresh go-ahead.
