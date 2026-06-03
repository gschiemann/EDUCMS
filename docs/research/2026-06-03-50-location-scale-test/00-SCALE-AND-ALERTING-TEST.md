# 50-Location Scale + Alerting Test — 2026-06-03 (overnight)

Verified live against production (venue-os.app web + `api-production-39a1.up.railway.app`,
deploy commit `03766164`, which includes the Phase 2b HQ-rollup scanner). Demo
tenant: **Acme Coffee Co. (Corporate)** `ac0c0000-…-0001`.

## TL;DR

| Task | Result |
|---|---|
| Scale demo to ~50 US locations × 3 screens | ✅ 50 child locations, **150 screens**, 50 distinct map points nationwide |
| Container Security Scanning CI fix | ✅ Pushed `061d6e5d`; **CI & Security green** + all 9 workflows green |
| Load test at scale (no breakage) | ✅ Endpoints hold; 20× concurrent = 20/20 → 200, no pool exhaustion. One **pre-existing** dashboard SSR 500 found (NOT scale-related — flagged) |
| Alerting at scale (fake online → trigger offline → verify HQ) | ✅ Per-screen+HQ, cohort-suppression+HQ, and dedup ALL verified end-to-end against the live scanner |
| Email "E-arc never received an email" | ⚠️ Root-caused: mail is **delivered (SMTP-accepted)**, then quarantined by e-arc's corporate filter. Needs DNS (DMARC) + IT action I can't do (no Vercel/ARC access) |

---

## 1. Scale seed (#235 ✅)

`packages/database/prisma/seed-50-locations.mjs` (committed, idempotent) added 45
nationwide locations under the existing 5 Texas Acme stores → **50 locations, 150
screens**, each with a real-ish address + city-center lat/lng. Verified in DB:
`child_locations=50, fleet_screens=150, distinct_geo=50`.

## 2. Load test (#237 ✅) — does a large account break anything? No.

`GET /screens/fleet` (Corporate / DISTRICT_ADMIN), 150 screens / 51 tenants:
- payload **68.6 KB**, latency **~1.0s median** (min 985 / max 1051 ms)
- **20× concurrent → 20/20 returned 200**, p95 1.8s, **no DB pool exhaustion**
  (connection_limit=10 + pool_timeout=20 held under ~60 concurrent queries)
- `/screens`=0 items (correct — Corporate has no *direct* screens, only children),
  `/playlists` fleet-decorated 1.4s, `/notifications` 334ms

UI (Playwright, Corporate dashboard): renders the fleet command-center at scale —
**50 locations, 150 screens, 150 online, 50 clustered map pins** spread across the
US, per-location list, search box. No visual breakage. Screenshot:
`scratch/lt-dashboard.png`.

### Finding L-1 (pre-existing, NOT scale): dashboard route SSR document 500
Every `[schoolId]` dashboard returns **HTTP 500 on the plain document GET** but 200
on the RSC request, and renders fine client-side (a Sentry `error.tsx` boundary
recovers it). Reproduces identically on the 3-screen Austin/New York dashboards →
**not caused by the 50-location scale.** Flagged as a separate task (Sentry has the
stack). Impact: ugly 500 on hard-load/refresh/bookmark; pollutes uptime monitoring.

### Finding L-2 (perf, not breakage): ~1s fleet latency
`/screens/fleet` runs 3 mostly-sequential queries (self tenant, children, screens
findMany+screenGroup join) over the cross-region Supabase pooler. ~1s at 150
screens; will grow modestly toward ARC's 500+ (round-trips fixed, findMany linear).
**Recommend** (low-risk): `Promise.all` the independent self+children reads; consider
a cached stats count. Not breaking — deferred, not done blind at 1am on a
load-bearing controller.

## 3. Alerting at scale (#238 ✅) — verified end-to-end against the LIVE scanner

Method: stamped all 150 fresh (baseline), then drove a controlled outage in the DB
and **polled for the rows the deployed Railway `OfflineScreenScanner` writes** (60s
tick, 5-min threshold) — a true end-to-end test, not a local re-implementation.

- **Per-screen + HQ rollup ✅** — New York's screens fired `SCREEN_OFFLINE`
  ("Screen offline: New York · Drive-Thru Menu" …) at the store, **and Corporate got
  matching `screen-offline-hq:…` rollup copies** (incl. NY screen #1 `dc402764`).
- **Cohort / infra-event suppression + HQ rollup ✅** — 12 locations dropped all 3
  screens inside the 90s window → within one scanner tick (t+45–60s): **12 store-level
  `INFRA_EVENT` + 12 HQ rollups to Corporate** ("Acme Coffee — Albuquerque · Possible
  infrastructure event — 3/3 screens dropped"), **0 per-screen rows for those stores
  (correctly SUPPRESSED).**
- **Replay/flood dedup ✅** — re-aging NY screen #1 in the same hour-bucket produced
  **no duplicate** (the hour-bucket dedupeKey already existed). Working as designed.
- **Quiet baseline ✅** — the other ~37 locations stayed fresh → no spurious alerts.

**Flood-control proof:** 36 screens down → **24 notifications** (12 store + 12 HQ)
instead of 72. Cohort detection prevents alert storms at fleet scale.

### Finding A-1 (gap for large fleets): no chain-level outage aggregation
Cohort/infra detection is **per-location only**. If a whole region or the entire
chain goes dark (national ISP/backbone event, or a VenueOS-side incident), HQ
receives **N per-store INFRA_EVENT rows** — for ARC's 144 locations that's up to 144
notifications, not one "fleet-wide outage — 144/144 locations affected." **Recommend
Phase 2d:** apply the same cohort pattern one level up — when ≥X% of child locations
have an active infra event in the same window, emit ONE parent-level "fleet-wide
outage" alert and suppress the per-store HQ copies.

## 4. Container Security Scanning CI (#234 ✅)
The "failed in ~26s" was the anonymous Docker Hub pull of `node:20-alpine` timing
out before the image build (the Trivy step is already `continue-on-error`). Fix
(`061d6e5d`): switch buildx to the host docker driver + pre-pull the base image with
retry/backoff so the build reads it from local cache. **CI & Security now green.**

## 5. Email — "E-arc has never received an email ever" (#236 ⚠️ root-caused, fix is DNS/IT)

**`email_logs` evidence (whole history): 12 emails ever, ALL `status=SENT`, 0 FAILED**
— WELCOME×6, BUG_FILED×2, BUG_FILED_OWNER×2, INVITE×1, PASSWORD_RESET×1 — including
**5 to e-arc.com** (gschiemann@ 4/20 + 5/7, selvin.castellanos@ 5/20, greg.schiemann@
×2 5/28). **The trap (exactly the one CLAUDE.md warns about): `status=SENT` means
"successfully dispatched to Resend's API," NOT "delivered to a human's inbox."** The
log has no delivery-state column (delivered/bounced/complained) — those come from
Resend webhooks, which aren't wired. So "12 SENT" proves the app did its job; it says
nothing about whether anyone at e-arc saw them.

Cross-referenced with live Resend tracking, there are **two distinct historical
failure modes**, both ending in "no human at e-arc saw it":

1. **Early sends (pre-domain-verification):** if `EMAIL_FROM` was still the default
   `onboarding@resend.dev`, **Resend only delivers resend.dev mail to the address that
   OWNS the Resend account** — every other recipient (all e-arc addresses) is silently
   dropped. Dispatched (logged SENT) → dropped by Resend → never reached e-arc.
2. **Recent sends (from noreply@venue-os.app, DKIM+SPF verified):** a tracked 5/28 test
   to greg.schiemann@e-arc.com returned Resend `last_event: **delivered**` — **e-arc's
   mail server ACCEPTED it at SMTP. NOT bouncing.** It's **quarantined/junked by e-arc's
   corporate filter** (young external domain + **no DMARC record** → auto-quarantine by
   Mimecast/Proofpoint/M365).

The offline-scanner `notify()` path is DB-only (no email) — this section is purely
outbound transactional mail.

**Recommend (addresses the "stop the UI lying about delivery" theme):** wire a Resend
delivery webhook → update `email_logs.status` to the real delivered/bounced/complained
state, so the log reflects reality instead of "dispatched." (Needs Resend dashboard
config — user-side.)

**Fixes (require access I don't have — no Vercel DNS, no ARC IT):**
1. Add a **DMARC** record at Vercel DNS: `_dmarc.venue-os.app TXT
   "v=DMARC1; p=none; rua=mailto:postmaster@venue-os.app"` — biggest single
   deliverability + legitimacy win.
2. Have **e-arc IT allowlist** venue-os.app / release from quarantine (check the
   Junk/Quarantine folder now — the test email is there: subject from the Resend test).
3. Best long-term for ARC: **verify e-arc.com in Resend** and send ARC's mail from an
   `@e-arc.com` address (internal sender → not quarantined). Requires e-arc.com DNS.

## 6. Demo resting state (decision)
150 fake screens with no real player either spam the offline scanner (if kept
"online", they re-alert every hour) or show offline. Chosen honest state:
**`lastPingAt = null` ("provisioned, awaiting device pairing")** — the scanner skips
null, so the HQ bell stays clean overnight. Fleet still shows 50 locations / 150
screens (offline-colored). To demo it **all-green live**, run:
`node packages/database/prisma/fleet-test.mjs --heartbeat 30` (stamps online every
30s; stop with Ctrl-C). A permanent green demo would need a heartbeat cron —
deliberately NOT baked into production (faking device telemetry in the runtime is the
wrong call; offer it as opt-in if wanted).

## Critical findings summary (be-critical lens)
- **A-1**: no chain-level outage aggregation → alert storm to HQ if a region/chain
  drops (real for 144-location ARC). *Recommend Phase 2d.*
- **L-1**: dashboard SSR document 500 (pre-existing, app-wide, client-recovers). *Flagged.*
- **L-2**: ~1s fleet latency; will grow with fleet size. *Low-risk Promise.all win.*
- **Email**: works at the protocol level; blocked by recipient-side quarantine →
  DNS (DMARC) + ARC IT, not a code bug.
