# Public-launch readiness audit — 2026-06-29 (code-verified)

Method: 9 domain agents code-verified all 21 Standard Audit Surface sections; every P0/P1
finding was then adversarially re-verified against the actual code by an independent agent
(default-reject when not confirmable). 68 agents, ~6M tokens. Master @ `7a36f994`.

## Headline
**The app is in excellent launch shape.** Of 20 "P0" findings, **19 were already-fixed
confirmations** — prior P0 fixes verified still in place on master (emergency timestamp unit,
manifest shape, all 9 player WS handlers, verifyWsHmac gate, audit immutability, Stripe
idempotency, multi-tenant isolation, Taurus inset-safety, canvas-fit, etc.). **Zero
code-fixable open P0s.** The single open P0 is a config action (rotate boot secrets).

Counts: 81 findings · 55 confirmed · 4 rejected · **1 open P0 (config)** · **6 open P1
(3 code-fixable, 3 config/decision)** · rest already-fixed.

## Coverage (all 21 sections)
Every Standard Audit Surface section covered. N-A (not built, correctly not surfaced as
working): §13 public-alert (CAP/IPAWS/Raptor/RapidSOS — only EULA references), AI
translation/TTS (competitive gaps), video transcode (50MB cap instead). Partial (code-verified,
not live-render-verified, per read-only rule): a11y keyboard-nav + WCAG contrast.

## OPEN — code-fixable (fixing this session)
1. **[P1] POS health dashboard under-claims live connectors** — `integrations-health.controller.ts:506-508`
   hardcodes Clover / Lightspeed / Shopify to COMING_SOON, but all three are `integrationTier:'DIRECT'`
   with real OAuth+catalog connectors (registry + providers + pos.service.syncConnection all live; the
   Concierge already shows them AVAILABLE). An *under*-claim isolated to the secondary health dashboard.
   Fix: gate COMING_SOON on `integrationTier !== 'DIRECT'` (mirror discovery.service); fix stale comment.
2. **[P1] Floor-plan images in the PUBLIC Supabase bucket** — `supabase-storage.service.ts:81,96` (public:true)
   + `floor-plans.controller.ts:467` upload there. Partial mitigation already in place (every read re-signs
   via `withSignedImageUrl`, 15-min TTL — API never emits the permanent URL), so exploitation needs an
   already-leaked URL → P1 not P0. Fix: route floor-plan uploads to a PRIVATE bucket, make serving
   bucket-aware, migrate existing objects. (Tracked: task #200.)
3. **[P1] AI-board → on-a-screen is multi-step + blocked on phone** — `templates/page.tsx:522-530`
   blocks the layout builder under 1024px; the only template→screen path is build-a-playlist→publish.
   The phone-first operator (Greg) cannot complete the most-marketed flow on a phone. Fix: a one-tap
   "Put on a screen" express lane on board cards + the AI candidate picker → single-item playlist →
   PublishToLocationsModal, bypassing the desktop-only builder.

## OPEN — config / decision (Greg's actions, no code)
- **[P0] Rotate the 4 boot secrets** before public launch: `JWT_SECRET`, `SESSION_SECRET`,
  `DEVICE_SECRET_KEY`, `DEVICE_JWT_SECRET` (boot already refuses to start without them). Rotating
  device secrets needs a re-pair or dual-secret overlap window — sequence during maintenance.
- **[P1] `ALLOWED_ORIGINS`** = `https://venue-os.app` (+ any aliases), no trailing slash (boot-gated).
- **[P1] `EMAIL_FROM`** must point at a Resend-verified domain (+ `RESEND_API_KEY`), else password-reset /
  invite / welcome mail is silently dropped for every non-owner recipient — breaks public self-signup.
- **[P1] `ANTHROPIC_API_KEY`** (platform Tier-1) on Railway so non-BYOK trial tenants get working
  sparkle / Concierge / AI-Designer instead of "AI not configured."
- **[P1] No staging environment** — master deploys straight to prod (decision: acceptable for the small
  pilot given the CI gate stack; stand up Railway staging when warranted).
- **[P1] `DATABASE_URL`** confirm `connection_limit>=10` + `pool_timeout>=20` (boot-gated; don't pin at 10
  under background-service load). **CSRF** stays enforced (don't set CSRF_ENFORCE=false / CSRF_WARN=true).
- **[config] `GOOGLE_MAPS_API_KEY`** for authoritative US address geocoding (works via OSM fallback today).
- **[config] `PEXELS_API_KEY`** — free, makes every photo-appropriate AI board come back with a real photo.
- **[hygiene] Demo-tenant smoke account** `admin@springfield.edu / admin123` can still log into prod as a
  single-tenant CONTRIBUTOR (already demoted from SUPER_ADMIN on 2026-05-28, so NOT a cross-tenant breach).
  It's a prod-smoke CI dependency — close by moving smoke creds to a GitHub secret + rotating the password,
  or isolating the demo tenant. Decision for Greg.
- **Stripe** keys: set when going paid, or leave dormant for the pilot (degrades gracefully either way).
- **POS OAuth app creds** (SQUARE/CLOVER/LIGHTSPEED/SHOPIFY `_CLIENT_ID`/`_SECRET`) per provider to go live.

## Rejected by adversarial verification (4) — not real open issues
- hold-to-trigger/typed-confirm/dedup, emergency a11y live-regions, mobile media-picker toolbar — all
  re-verified as **already-fixed** (the finder mis-flagged a working feature).
- seed SUPER_ADMIN public password — re-verified: prod row already demoted to CONTRIBUTOR (see hygiene
  item above); the P0 framing was stale.

## Already-fixed confirmations (the good news)
All 8 emergency P0s, Stripe idempotency + License-mutation audit, audit_logs DB immutability,
multi-tenant isolation (spot-checked templates/assets/screens/billing), passport-saml CVE remediated,
JWT revocation + panic-token staleness, all 5 previously-"costume" verticals now editable,
CC-1 canvas-fit + CC-2 empty-schedule idle, Taurus inset/gap clean, mobile bugs 1/2/3, mobile-perf
guard intact, POS pull/auto-86 real, design-imports real. Raw detail: `RAW-RESULT.json`.
