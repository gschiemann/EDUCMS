# Launch-Readiness / Deploy / Billing Audit — VenueOS (EDU CMS)

**Date:** 2026-06-08 · Read-only (+ gh/curl/Railway-MCP env read) · Agent: a1d843a737c304527

## Summary

**The deploy is launch-ready from an infrastructure/health standpoint, but there are launch blockers in CONFIGURATION, not code.** Live Railway API healthy (`db=ok, redis=ok`, ~10h uptime), Vercel web serves `/login` 200, all three health endpoints respond correctly, every CI workflow on master is GREEN, billing/onboarding/emergency code paths degrade or function correctly. Master is 2 commits ahead of the live API commit (`698a7943` vs deployed `90be6ff`) — both undeployed commits are template-gallery perf fixes, not blockers.

**The brief's premise that "billing is dormant until Stripe keys are set" is FALSE in production: Stripe IS configured — with TEST-mode keys.** That, plus **low-entropy production auth secrets in a PUBLIC repo's deploy env**, are the items to resolve before invoicing a real customer.

## CI / deploy state — all GREEN on master (2026-06-08)

| Workflow | Last run | Conclusion |
|---|---|---|
| Deploy Reliability | 05:32 | success |
| CI & Security | 05:32 | success |
| Cross-Browser | 05:32 | success |
| Emergency Path | 05:32 | success |
| Taurus Safety | 05:32 | success |
| Accessibility (axe-core) | 05:32 | success |
| OTA Wiring Integrity | 05:32 | success |
| Android Player APK | 05:32 | success |
| Keep API warm | 12:02 | success |
| Prod Smoke | 10:51 | cancelled (concurrency, not a failure) |

**Master shippable? YES.** Deploy Reliability jobs confirmed present: `apk-version-tag-sync`, `lockfile-check`, `api-build`, `web-build`, `docker-build` (`.github/workflows/deploy-reliability.yml:27-179`).

## Health + deploy-reliability verification

| Safeguard | Present? | Evidence |
|---|---|---|
| Liveness always 200 (no DB/Redis gate) | YES | `health.controller.ts:79-119` — best-effort `withTimeout` |
| `/health/ready` 503s when DB down | YES | `health.controller.ts:140-143` |
| `/health/emergency-path` (DB + WS signer) | YES | `:151-192`; live 200 |
| `healthcheckPath` set | YES | `railway.json` → `/api/v1/health`, timeout 60 |
| 10-retry restart policy | YES | `railway.json` ON_FAILURE, max 10 |
| 7s Redis hard-cap | YES | `redis.service.ts:78,99-101` |
| Health exempt from throttle | YES | `@SkipThrottle()` `health.controller.ts:44` |
| Dockerfile Alpine toolchain + prisma copy order + frozen lockfile | YES | `Dockerfile:9,28,31` |
| Live API healthy | YES | `curl …/health` → `{"status":"ok","db":"ok","redis":"ok","uptime_s":35725}` |

## Billing go-live readiness

**Stripe is NOT dormant in prod — it is live in TEST mode.** Railway env: `STRIPE_SECRET_KEY=sk_test_…`, `STRIPE_PRICE_MONTHLY=price_1TYgFy…`, `STRIPE_PRICE_ANNUAL=price_1TYgL9…`, `STRIPE_WEBHOOK_SECRET=whsec_…` all set → `StripeService.enabled()` returns **true** → the UI shows a working "Upgrade" button opening a real test-mode Checkout.

- **Degradation path (when keys unset) is correct** — verified by reading: checkout/portal → `{enabled:false}` (`billing.controller.ts:63-68,92-97`), invoices → `{stripeEnabled:false, invoices:[]}` (`stripe.service.ts:271-273`). Moot here because keys are set.
- **Webhook hardening excellent:** idempotency ledger (`processedStripeEvent`), out-of-order protection (`stripeLastEventCreatedAt`), AuditLog per mutation, all in `$transaction` (`stripe.service.ts:327-702`).
- **Go-live checklist** in CLAUDE.md: steps 1-4 effectively done (test keys+prices+webhook secret in env); **step 5 (test cards) + step 6 (swap to live keys) open.**
- **PILOT_SEAT_LIMIT = 1000** (`license.service.ts:33`) — the deliberate testing value, **not yet flipped** to the contracted count.
- **`activate-trial` is an honest read-only status probe, NOT a cosmetic stub** — calls `license.getEffective()`, returns `committed:false` with accurate tier/seatLimit (`billing.controller.ts:142-161`). Free tier is the no-License default; nothing to persist. A real card-on-file trial would need a new `POST /billing/start-trial` upserting a License (documented follow-up).

## Onboarding / signup + email verdict
**Robust; no hard dependency on an unset env var.**
- `signup()` (`onboarding.service.ts:64-190`) creates Tenant + first DISTRICT_ADMIN in a transaction, then logs in → working dashboard.
- **Welcome email cannot break signup:** dispatch failure caught inside `#enqueue` (`email.service.ts:121-138`), marks `email_logs` FAILED, doesn't rethrow.
- **Email WILL send in prod:** `RESEND_API_KEY=re_…`, `EMAIL_FROM=VenueOS <noreply@venue-os.app>` both set — avoids the `onboarding@resend.dev` trap. **Caveat:** `venue-os.app` must be a *verified sending domain* in Resend or mail to non-account recipients is silently dropped (can't verify dashboard from here).
- Google Maps key set; degrades to OSM otherwise. No signup-blocking env dependency.

## Emergency-drill readiness verdict
**READY — a live trigger→all-clear works with zero screens present.** Tenant-scope trigger updates `Tenant.emergencyStatus`, writes immutable AuditLog, publishes signed message to Redis in a `$transaction` independent of any paired screen (`emergency.controller.ts:483-580`); all-clear reverses + signs (`:644-757`). Prod supports it: `REDIS_URL` set + live `redis=ok`, signer secrets set, `/health/emergency-path` 200. Verifiable drill artifact even with no screen: the AuditLog row + toggled `emergencyStatus`.

## Env / config gaps

| Var | Required at boot? | Documented? | Risk |
|---|---|---|---|
| JWT_SECRET / SESSION_SECRET | Yes (prod) | Yes | **HIGH — prod values are low-entropy guessable strings (`super_secure_beta_jwt_secret_2026_xYz`)**. Pass `requireSecret` (≥16) but not random. |
| DEVICE_SECRET_KEY / DEVICE_JWT_SECRET | Yes (prod) | Yes | OK — 64-hex random |
| ALLOWED_ORIGINS | Yes (throws if unset) | Yes | OK — set, includes venue-os.app |
| SSO_ENCRYPTION_KEY | No (lazy) | Yes (empty placeholder) | LOW — unset; only throws if a tenant configures SSO (Sprint 2) |
| ANTHROPIC_API_KEY | No | Yes | LOW — **unset in prod** → AI returns graceful 503 |
| RESEND_API_KEY / EMAIL_FROM | No (throws on send if unset) | Yes | OK — set; verify domain |
| STRIPE_* | No | Yes | TEST keys (see billing) |
| DATABASE_URL connection_limit | n/a | Yes | OK — prod uses `connection_limit=25&pool_timeout=20` |

**No secrets committed to git** (`.env` gitignored; weak secrets live only in Railway env). Note: `GH_TOKEN=gho_…` (live GitHub PAT) sits in the Railway env — operationally fine but a real credential worth rotating if that env is ever shared.

## Deploy-config drift
No risky recent drift. `railway.json` last meaningful change = OTA target bump (`v1.0.63`, 2026-05-15); deployed APK env (`PLAYER_APK_LATEST_VERSION_CODE=10063`) matches — no OTA loop. Dockerfile last touched 2026-05-21, structurally sound. The 2-commit live/master gap is perf work, low-risk.

## Findings ranked

### P0-1 — Stripe is live in TEST mode; "Upgrade" will not take a real payment
Railway env `STRIPE_SECRET_KEY=sk_test_…` + test-mode prices → `enabled()` true → working Checkout button. First customer clicks Upgrade → test-mode Checkout rejects a real card; OR you swap to `sk_live_` without ever testing the webhook→License sync against live events. **Fix:** complete CLAUDE.md Stripe steps 5-6 — run an end-to-end test-card purchase (verify `checkout.session.completed` webhook lands + upserts License to ACTIVE), then swap secret + both prices + webhook secret to live and re-point the Stripe webhook at `…/api/v1/billing/webhook`. Do NOT skip the test-card pass. **NEEDS GREG (billing config + decision).**

### P0-2 — Production JWT_SECRET and SESSION_SECRET are low-entropy, guessable, in a PUBLIC repo's deploy
`JWT_SECRET=super_secure_beta_jwt_secret_2026_xYz`, `SESSION_SECRET=super_secure_beta_session_secret_2026_xYz` — satisfy `requireSecret` ≥16 but are human-readable patterns, not 64-hex random. A forged JWT = cross-tenant account takeover. **Fix:** regenerate both with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`, set on Railway, redeploy (rotating invalidates live sessions — do it before the customer onboards). **NEEDS GREG (prod secret rotation).**

### P1-1 — PILOT_SEAT_LIMIT still 1000; flip + verify License upsert at first paid onboarding
`license.service.ts:33` — drop to contracted seat count AND verify the License upsert path end-to-end (comment notes two prior seat-bump migrations silently failed). A paying customer metered at 1000 free seats; the paid-enforcement write path is unproven in prod. **Fix:** set contracted limit, do one real License upsert to prove the path writes. **NEEDS GREG.**

### P1-2 — Confirm `venue-os.app` is a verified sending domain in Resend
If not verified, every reset/invite/welcome email is silently dropped (the "no emails arrive" trap). **Fix:** Resend dashboard → Domains; send one real password-reset to a non-account address and confirm delivery. **NEEDS GREG (dashboard check).**

### P2-1 — Stale doc comment: `license.service.ts:4-9` header still says "Pilot tier: 3 seats, COMP billing" while the limit is 1000. Cosmetic; fix when flipping P1-1.
### P2-2 — `GH_TOKEN` (live GitHub PAT) in Railway API env. Not in git, but a real credential. Confirm it's needed by the running API; scope minimally; rotate if env ever shared.
### P3-1 — `SSO_ENCRYPTION_KEY` unset in prod. Lazy (`sso.crypto.ts:28-42`), boot fine; first SAML/OIDC config will 500. Set before enabling SSO (Sprint 2).
### P3-2 — Live API 2 commits behind master (perf fixes). Redeploy at convenience.

**For the record:** billing degradation engineering is correct (graceful `{enabled:false}`/`[]` when keys unset, no 500). The risk is the *configuration* (test keys live), not the code.
