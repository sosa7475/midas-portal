# Getting Midas onto your iPhone via TestFlight

Two-part sequence: **deploy the backend (Fly)**, then **build + submit the app (EAS → TestFlight)**.
Steps marked 🧑 need you (auth prompts I can't do); steps marked 🤖 I run.

## What works in this first test build
- ✅ Sign up / log in, define a strategy, **chat with the AI agent**, **screenshot chart analysis**, journal UI
- ❌ Live balance / trade execution — needs Orderly creds + the Phase 3 ed25519 rewrite. Wallet/Trade tabs will error. Expected.

---

## Part A — Deploy the backend to Fly

**A1. 🧑 Log into Fly** (in your terminal):
```
~/.fly/bin/flyctl auth login
```

**A2. 🧑 Get a Neon Postgres URL** — neon.tech → new project → copy the `postgresql://...` connection string (pooled, with `?sslmode=require`).

**A3. 🧑 Get one LLM key** — an `sk-...` from OpenAI, or `sk-ant-...` from Anthropic.

**A4. 🧑 Paste the Neon URL + LLM key here.** Then 🤖 I run:
```
fly apps create midas-portal-api
fly volumes create midas_uploads --size 1 --region iad --app midas-portal-api
fly secrets set --app midas-portal-api \
  DATABASE_URL="<neon>" JWT_SECRET="$(openssl rand -hex 24)" \
  ENCRYPTION_KEY="$(openssl rand -hex 32)" OPENAI_API_KEY="<key>" \
  ALLOWED_ORIGINS="https://midas-portal.vercel.app"
fly deploy --config apps/api/fly.toml       # runs migrations via release_command
curl https://midas-portal-api.fly.dev/health   # expect {"status":"ok"}
```
The app is already wired to `https://midas-portal-api.fly.dev`, so nothing to change after this.

---

## Part B — Build + submit to TestFlight

**B1. 🧑 Create/link the EAS project** (from `apps/mobile`, pick the account that owns the `com.agilityautomations.midasportal` bundle id):
```
cd apps/mobile
eas init
```
This writes `extra.eas.projectId` into app.json — commit it.

**B2. 🧑 Build for iOS** (EAS will walk you through Apple login + certificate/provisioning creation — let it manage credentials):
```
eas build --profile production --platform ios
```
~20-40 min on EAS servers.

**B3. 🧑 Submit to TestFlight:**
```
eas submit --profile production --platform ios --latest
```
Needs your Apple ID / App Store Connect. Uploads the build; Apple processes it (~5-15 min).

**B4. 🧑 In App Store Connect → TestFlight**, add yourself as an internal tester. Install the **TestFlight** app on your iPhone and open the invite.

---

## Notes
- **App icons/splash are placeholders** — fine for testing; real assets are a Phase 5 task.
- After the web app is deployed to Vercel (later), add its real origin to `ALLOWED_ORIGINS` via `fly secrets set`.
- To ship a new build after code changes: bump nothing (autoIncrement handles build number) → `eas build ... && eas submit ...` again.
