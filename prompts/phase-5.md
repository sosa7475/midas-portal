# Phase 5 — Mobile hardening & TestFlight

**Read first:** `BUILD_SPEC.md` §3 (Phase 5), §4 (design), §5 (security). **Prerequisite:** Phase 4 DoD green. **Needs:** Apple Developer + Google Play accounts, EAS `projectId`.

## Scope
Make the Expo app store-ready and ship it to TestFlight. Parity with web, same Fly API, glass design.

## Tasks
- [ ] Consume `packages/shared` types/client (remove duplicated mobile API code).
- [ ] `expo-notifications`: push for fills/price alerts; register push tokens server-side.
- [ ] Set `extra.eas.projectId` + owner; real app icons/splash/store screenshots.
- [ ] Biometric app-lock (`expo-local-authentication`); token in secure-store; error boundaries; offline handling.
- [ ] Live positions/prices (client WS or API stream).
- [ ] Point app at the **production Fly API**; apply glass design system (§4).
- [ ] EAS build + submit pipelines; `eas submit` to **TestFlight** (iOS) and Play internal track (Android); financial-app review notes.

## Definition of Done
- [ ] `eas build --profile production --platform all` succeeds; **iOS build live on TestFlight** (installable by testers).
- [ ] Push notification delivered on a real device when a testnet order fills.
- [ ] On-device: register → strategy → analyze → confirm trade → journal against production API.
- [ ] Security: biometric app-lock works; token in secure-store; no secrets in the JS bundle.

**Stop when green.** Report the TestFlight status and blockers for Phase 6.
