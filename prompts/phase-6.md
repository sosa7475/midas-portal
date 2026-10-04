# Phase 6 — Production hardening

**Read first:** `BUILD_SPEC.md` §3 (Phase 6), §5 (security), §6 (conventions). **Prerequisite:** Phase 5 DoD green.

## Scope
Observability, tests, CI/CD, secrets/compliance — make it operable and safe to run for real users.

## Tasks
- [ ] Sentry (web + mobile + api) with source maps; structured logging; uptime/health checks.
- [ ] Test suites: unit (indicators, Orderly signing, risk engine, crypto), integration (API routes), e2e (Playwright web, Maestro/Detox mobile). Meaningful coverage on `packages/analysis`, `packages/exchange`, `packages/agent`.
- [ ] GitHub Actions: typecheck + lint + test on PR; deploy `apps/api` → Fly + `apps/web` → Vercel on merge to main; EAS build/submit on release tag.
- [ ] Secrets management + `ENCRYPTION_KEY` rotation plan; separate staging vs prod envs/secrets.
- [ ] Compliance pass: risk disclaimers, no-financial-advice framing, jurisdiction/geo + KYC review as a go-to-market gate. `pnpm audit`/Dependabot.

## Definition of Done
- [ ] CI green on PR; deploys automated on merge.
- [ ] Errors surface in Sentry with source maps.
- [ ] Documented runbook: deploy, rotate keys, roll back, on-call for stuck orders.
- [ ] Security: dependency audit clean; staging/prod secrets separated; audit logs verified for auth + orders.

**Done = production-ready.** Report final status and any residual risks.
