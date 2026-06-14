# Midas Portal — TestFlight Setup Guide

Everything in the codebase is now build-ready. This guide covers the remaining
account/deploy steps that require your credentials.

## Status checklist

- [x] Real app icon + splash (1024×1024, gold "M" coin) — `mobile/assets/`
- [x] Bundle identifier set — `com.agilityautomations.midasportal`
- [x] EAS build profiles (development / preview / production) + submit config
- [x] Chat screen no longer crashes (removed `uuid` crypto dependency)
- [x] Backend is serverless-safe (in-memory uploads, no disk writes)
- [ ] Backend deployed to an HTTPS URL  ← **you**
- [ ] `EXPO_PUBLIC_API_URL` set to that URL in `mobile/eas.json`  ← **you**
- [ ] Apple Developer Program membership ($99/yr)  ← **you**
- [ ] `eas login` + first build  ← **you**

---

## 1. Deploy the backend (Vercel)

The mobile app cannot talk to `http://10.1.10.76:3001` (LAN-only, and iOS blocks
plain HTTP). Deploy the backend to HTTPS first.

```bash
cd backend
npm i -g vercel        # if needed
vercel                 # first deploy (creates the project)
vercel --prod          # production deploy → gives you https://<name>.vercel.app
```

Set these as Vercel **Environment Variables** (Project → Settings → Environment
Variables) — see `backend/.env.example` for the full list:

- `DATABASE_URL` (Neon Postgres — run the schema in `backend/src/db/schema.sql`)
- `JWT_SECRET`, `ENCRYPTION_KEY` (32-char hex)
- `ACTIVE_LLM_PROVIDER=openai`, `OPENAI_API_KEY`, `OPENAI_MODEL`
- `ORDERLY_*` keys
- `ALLOWED_ORIGINS` (optional; defaults to `*`)

Verify: open `https://<name>.vercel.app/health` → should return `{"status":"ok"}`.

> Run the DB migration once: `DATABASE_URL=... npm run db:migrate` (from `backend/`).

## 2. Point the app at the deployed backend

Edit `mobile/eas.json` and replace **both** occurrences of
`https://REPLACE-WITH-YOUR-DEPLOYED-BACKEND.vercel.app` (in the `preview` and
`production` profiles) with your real Vercel URL.

## 3. Build & submit to TestFlight

```bash
cd mobile
npm i -g eas-cli       # if needed
eas login              # your Expo account
eas init               # links project, writes extra.eas.projectId into app.json

# First, fill in the submit credentials in eas.json:
#   appleId, ascAppId, appleTeamId   (from App Store Connect)
# Create the app record in App Store Connect with bundle id
#   com.agilityautomations.midasportal

eas build --platform ios --profile production
eas submit --platform ios --profile production --latest
```

EAS manages signing certs/provisioning automatically. After `eas submit`, the
build appears in App Store Connect → TestFlight in ~5–15 min (after processing).
Add internal testers there to start testing — internal testing skips Apple review.

## Notes

- **Internal TestFlight** (up to 100 testers on your team) needs no App Review.
  **External** testing does require a review pass — crypto/trading apps get extra
  scrutiny (App Store Guidelines 3.1.5 / 3.2.1 / 5.2.3); you may need to be a
  registered financial entity and add geo-restrictions for external release.
- To test the production build against a local backend instead, use the
  `development` profile (`EXPO_PUBLIC_API_URL=http://localhost:3001`) with
  `eas build --profile development` + a dev client.
