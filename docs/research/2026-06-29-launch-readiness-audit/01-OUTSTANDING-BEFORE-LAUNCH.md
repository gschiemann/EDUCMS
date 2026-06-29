# Outstanding before launch — consolidated across all audits (2026-06-29)

Reconciles every audit this week (06-25 live-test, 06-26 final-beta [1 P0/17 P1/72 P2],
06-27 per-vertical, 06-29 launch-readiness [68 agents]) against current master + what
shipped today. Older audit items were re-verified; only what is STILL open is listed.

## ✅ Closed since the audits (so you don't chase them)
- POS-webhook CSRF P0 (06-26) — `/pos/webhook/*` now in CSRF EXEMPT_PATHS (`csrf.middleware.ts:137`). FIXED.
- 5 "costume" verticals (06-27) — CORPORATE/WORSHIP/HEALTHCARE/HOSPITALITY/GYM now editable. FIXED.
- CC-1 canvas-mismatch clip + CC-2 schedule-delete blank (06-27) — FIXED.
- POS health dashboard under-claim, floor-plan public bucket, AI-board→screen on phone — FIXED TODAY.
- AI agent: now uses chat + URL (business-type) + brand; deterministic text-fit engine; never ships a guessed/wrong photo — SHIPPED TODAY (live-verified).

## 🔴 P0 — must do before public launch (CONFIG, only you can do)
1. **Rotate `JWT_SECRET` + `SESSION_SECRET`.** Live prod values are weak placeholder strings
   (`super_secure_beta_..._2026`). Guessable → forge a session/JWT for ANY tenant. Generate
   64-hex random, set on Railway, redeploy. (DEVICE_* secrets are already proper random.)

## 🟡 P1 — should do before / at launch
**Config / secrets (you):**
2. **`ANTHROPIC_API_KEY`** — not set in prod, so no-BYOK trial signups get "AI not configured."
   Conscious decision: setting it makes the platform key bill for free-tier AI (200/mo cap). Set it
   for the "AI is the star" launch story.
3. **`PEXELS_API_KEY`** (free) — without it, AI boards get a gradient instead of a real photo (this is
   the "sunset" lever; with it, boards pull a real keyword-matched image). 2-min config.
4. **`EMAIL_FROM` / Resend** — `EMAIL_FROM` is set to `@venue-os.app` (good), but CONFIRM that domain is
   verified in Resend (DKIM/SPF). If not, password-reset / invite / welcome mail silently drops for every
   non-owner recipient → breaks public self-signup.
5. **`PILOT_SEAT_LIMIT` = 1000** (`license.service.ts:33`) — billing metering effectively OFF (an HQ can
   pair unlimited screens free). Drop it + wire Stripe if charging at launch, or accept for a free pilot.
6. **Demo-tenant smoke login** `admin@springfield.edu / admin123` can authenticate to prod (single-tenant
   CONTRIBUTOR — NOT a cross-tenant breach, already demoted, but a publicly-known password). Move the
   prod-smoke creds to a GitHub secret + rotate the password.
7. **Remove `GH_TOKEN` from the API runtime env** — a GitHub token in the app process is unnecessary exposure.

**Code (me — small, do this round):**
8. **Run the floor-plan migration once** (`apps/api/scripts/migrate-floorplans-to-private.ts`). New floor-plan
   uploads already go to the private bucket; this copies any EXISTING plans over + repoints rows. Needs your
   go-ahead (it touches prod storage).
9. **Re-verify the 06-26 "A3" publish data-loss P1** — a CONTRIBUTOR staging a DRAFT for a (playlist, screen)
   an admin already has LIVE was reported to silently hard-delete the admin's live schedule. I have NOT
   re-confirmed this on current master — first thing I'll check; if still open it's a same-day fix.
10. **AI cross-vertical polish** (in progress, fleet now available) — tune inter-column spacing + the
    `data-photo-query` relevance, and run generate→render→critique across coffee/bar/retail/gym to confirm the
    new text-layout engine holds everywhere.

## 🔵 Decisions / deferrable (conscious, NOT blockers for a pilot)
- **Staging environment** (#221) — push-to-master deploys straight to prod; guarded by the CI gate stack.
  Defensible to defer for a small pilot; stand up Railway staging when warranted.
- **Login rate-limit → Redis** — a 10/min throttle exists but is in-memory/per-replica (multi-replica it's
  10×replicas, resets on restart). Hardening, not a hole. Migrate to Redis post-launch.
- **Auth Phase 2/3** — TOTP authenticator + WebAuthn passkeys (#50) — post-launch.
- **passport-saml CVE** (#199) — only matters if/when SAML is enabled for a tenant (it is NOT). Migrate before
  enabling SAML.
- **Email send-path audit** (#236) — once Resend domain is confirmed, walk every send path (reset/invite/
  welcome/bug-reporter) end-to-end.
- **"Powered by VenueOS" attribution** decision (#52).
- **P2 polish backlog**: HTML-entity double-encode on a few AI/holiday strings (#61, LIVE-AI-4), stable
  error-envelope `code` on every controller (#57), legacy geocode backfill (#60), per-vertical branding
  sample URLs (#51), gallery "Athletics" empty-tab + empty-state, manifest dup when group+per-screen schedule
  overlap, drop-a-pin add-location (#220).

## Bottom line
Code is essentially launch-ready — the real gate is **7 config/secret/decision items you own**, headed by
rotating the two weak secrets (the only true P0). I have 3 small code items (floor-plan migration run, A3
re-verify, AI cross-vertical polish). Everything else is conscious-defer P2.
