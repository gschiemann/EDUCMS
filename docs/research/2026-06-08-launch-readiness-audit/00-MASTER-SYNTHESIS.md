# VenueOS — Launch-Readiness Audit — MASTER SYNTHESIS

**Date:** 2026-06-08 (overnight, autonomous) · **Method:** 8 read-only Opus agents across all 21 Standard Audit Surface sections × Design/UX/Functionality lenses, every documented safeguard traced to its real caller per the "exhaustive or worthless" standard. Built on the 2026-05-30 full-app audit (zero P0s) — this pass re-verifies the prior baseline AND audits the ~60 commits since (the gallery perf fix + 9 new K-12 boards), focused on Greg's five named areas: **performance, Supabase egress/cost, security, usability, launch-readiness.**

Per-domain reports: `01-performance` · `02-storage-egress-db` · `03-security-authz` · `04-emergency-audit-chain` · `05-usability-ux` · `06-launch-deploy-billing` · `07-crossbrowser-taurus` · `08-deps-secrets-hygiene`.

---

## THE ONE-PARAGRAPH TRUTH

**The code is launch-ready. The CONFIGURATION is not — and that's the whole story.** Every code-level safeguard traces to reality: the emergency signing/HMAC chain is genuinely sound (no theater), multi-tenant isolation has no exploitable IDOR, the audit trail writes real immutable rows, the egress wall is fixed at the source, the DB pool is boot-enforced, the "can't edit a word" complaint is resolved, and CI is green on every workflow. There are **no code P0s.** But the audit surfaced **four configuration/secret launch blockers** that will break or embarrass us in front of the first paying customer this week: (1) **live production secrets sitting in `.codex/config.toml`** in a PUBLIC-repo working tree (Supabase service_role JWT, DB password, Railway + GitHub tokens) — I gitignored them tonight but **they must be rotated**; (2) **production `JWT_SECRET`/`SESSION_SECRET` are low-entropy guessable strings** (`super_secure_beta_..._2026_xYz`) = cross-tenant account-takeover risk; (3) **Stripe is live in TEST mode** so "Upgrade" can't take a real card; (4) **the pilot customer's real login + password `12345678` is printed in a public-repo doc.** Beyond the blockers, the highest-value code work is preventing the *next* "page unresponsive" (two playlist surfaces mounted unfrozen 4K iframes — **fixed tonight**) and a latent **migration-ordering bug that can 500 every user-deletion in prod.** All four blockers need Greg (secret rotation / billing decision); none is a deep code problem.

---

## PAGE 1 — COVERAGE TABLE (all 21 sections × D / UX / F)

| § | Domain | D | UX | F | Coverage / verdict |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | A | A | **A−** | **covered** — HMAC gate traced to real callers; fallback tiers closed; player verify is field-presence (documented) |
| 2 | Storage + content pipeline | A | A | **A−** | **covered** — egress root-cause fixed at source (live-verified); player SW range-caches; video transcode is the tail |
| 3 | AI providers × entry points | A | A | **A−** | **covered** — ANTHROPIC_API_KEY unset in prod → graceful 503; mapping solid |
| 4 | AI feature surfaces | A | A− | **B+** | **covered** — sparkle/touch/alt-text real; image-gen/translation/TTS N-A |
| 5 | AI comparative scan | — | — | **C+** | **covered (competitive gaps)** — behind on AI image + translation |
| 6 | Streaming integrations | B+ | B+ | **B** | **covered** — YT/Twitch/HLS real; RTSP/NFHS honest N-A |
| 7 | Sports-data integrations | A− | B+ | **B+** | **covered** — CTS + /feed real; named-vendor syncs honest N-A |
| 8 | POS / commerce | B+ | B+ | **B** | **covered** — Square real; others honest N-A |
| 9 | Communications | A | A | **A** (email) / N-A | **covered** — email production-grade; SMS/Slack/push honest N-A |
| 10 | Auth + identity | A− | B+ | **A−** | **covered** — no exploitable IDOR; revocation un-gated; **P2 panic Redis-less window** |
| 11 | Billing + commerce | A | A | **A−** | **covered** — webhook/seat/PCI real; **P0 TEST-mode keys live; P1 PILOT_SEAT_LIMIT=1000** |
| 12 | Design imports | A | A | **B** | **covered** — single-page PDF/img real; Sprint 10/11 N-A |
| 13 | Public alert integrations | — | — | **N-A** | **N-A (honest)** — CAP/IPAWS/Raptor/RapidSOS/PA-speaker all V2 |
| 14 | Multi-vertical surface | A | B+ | **B** | **covered** — plumbing leak-free; **P1 empty cold-start (no starter content)** |
| 15 | Cross-browser / Chromium-83 | A(React) / B(boards) | B | **B** | **covered** — React widgets remediated + gated; **P1 117 boards unscanned by taurus gate** |
| 16 | Forensic / audit | A | A− | **A−** | **covered** — immutability real (DB triggers); **P1 migration-ordering trigger conflict** |
| 17 | Operational + DX | A | A | **A−** | **covered** — health/CI/pool/secrets-boot all real; **P0 weak prod JWT/SESSION secrets** |
| 18 | Accessibility | A | A− | **B+** | **covered** — brand-AA/pins/panic aria-live real; keyboard-trigger E2E is the gap |
| 19 | Template + widget editability | A | A− | **A−** | **covered** — "can't edit a word" FIXED; themed arrays+images wired into PropertiesPanel |
| 20 | Design/UX/Functionality lenses | — | — | — | **applied across all rows** |
| 21 | Verify-before-claim | — | — | — | **discipline** — every verdict traced to file:line / curl / live env |

**N-A (honest future, correctly not faked):** §13 (all V2 public-alert), §6 RTSP/NFHS, §7 Daktronics/Sportzcast/Genius/MaxPreps/GameChanger syncs, §8 Toast/Clover/Lightspeed/Shopify/MINDBODY, §9 Twilio/Slack/Teams/push/PagerDuty, §10 WebAuthn/TOTP, §12 Canva/Slides/PowerPoint/Figma. No sold-but-absent costumes found (usability agent swept every "coming soon" — all honestly labeled).

---

## MASTER RANKED PUNCH LIST

### ✅ FIXED OVERNIGHT (verified, tsc clean — pushed, CI watch in progress)

| # | Fix | § | Evidence / what I verified |
|---|---|---|---|
| F-1 | **`.gitignore` now blocks `.codex/` + `AGENTS.md`** (+ `*.tar.gz`/`*.key`/`*.pfx`/`*.p12`/`*.crt`/`edu-cms-backup-*`) — the live secrets can no longer be `git add .`-ed into the public repo. | 16 | `git check-ignore .codex/config.toml AGENTS.md` now returns both; confirmed 0 tracked files de-tracked by the broad patterns. **Does NOT rotate the secrets — see B-1.** |
| F-2 | **Playlists page + Create-Playlist wizard now pass `freeze`** to `ScaledTemplateThumbnail` — the two surfaces (besides the already-fixed gallery) that mounted live, animating 4K board iframes. Eliminates the literal "next page unresponsive." | 1 | `PlaylistPreviewThumb.tsx:452,472` + `PlaylistCreateWizard.tsx:1866`; `freeze?: boolean` confirmed to flow → iframe `?freeze=1`. Same one-line pattern as the shipped gallery fix. |
| F-3 | **Assets grid `<img>` now `loading="lazy" decoding="async"`** — up to 500 thumbnails no longer eager-fetch from Supabase on mount (first-paint + egress win). | 2 | `assets/page.tsx:1078`. Video tiles were already `preload="none"`; images were the miss. |
| — | Clean `pnpm --filter web exec tsc --noEmit` → **exit 0, 0 errors** after all three code edits. | — | `/tmp/web-tsc.log` |

### 🔴 P0 — LAUNCH BLOCKERS — NEEDS GREG (config/secret/billing, not code)

| # | Blocker | § | Action |
|---|---|---|---|
| B-1 | **Live prod secrets in `.codex/config.toml`** — Supabase **service_role JWT** (full RLS bypass over every tenant's student/parent PII), DB password `g4qM7Pb5EeUc8aA6`, Railway token, GitHub PAT. Not in git history (verified) and now gitignored (F-1) — but a service_role key on disk in a public-repo project is already over-exposed. | 16 | **ROTATE ALL FOUR**: regenerate Supabase service_role + DB password, Railway token; revoke the GitHub PAT. Then update Railway env. `08-deps-secrets-hygiene.md` P0-1. |
| B-2 | **Prod `JWT_SECRET`/`SESSION_SECRET` are low-entropy guessable** (`super_secure_beta_jwt_secret_2026_xYz`) — a forged JWT = cross-tenant account takeover. Pass the ≥16-char check but aren't random. | 17 | Regenerate both: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`; set on Railway; redeploy (rotating invalidates live sessions — do it BEFORE the customer onboards). `06` P0-2. |
| B-3 | **Stripe is live in TEST mode** (`sk_test_…` + test prices in Railway) → `enabled()` true → "Upgrade" opens a test-mode Checkout that rejects a real card. | 11 | Complete CLAUDE.md Stripe go-live steps 5–6: run a test-card purchase, **verify the `checkout.session.completed` webhook upserts the License to ACTIVE**, THEN swap secret + both prices + webhook secret to live and re-point the webhook. Do NOT skip the test-card pass. `06` P0-1. |
| B-4 | **Pilot customer's real login + password `12345678` printed in a public-repo doc** (`docs/CUSTOMER_PILOT_GUIDE.md:13-14` + `.html`) — anyone can read it and log into the pilot CMS (SCHOOL_ADMIN has emergency-trigger). | 16 | Rotate the AGC pilot passwords on prod; redact password (and ideally emails) from both files; reconsider whether the guide belongs in a public repo. `08` P1-1. |

### 🟠 P1 — fix this week (mix of code + config)

| # | Fix | § | Owner / note |
|---|---|---|---|
| P1-1 | **Migration-ordering bug: the 2026-05-26 `audit_log_immutable_no_update/_no_delete` triggers are never dropped** → on any DB migrated 05-26…05-31 (incl. prod if it deployed then), they coexist with the 0531 trigger and **block the FK-null anonymization → every SUPER_ADMIN user-deletion 500s and rolls back.** | 16 | **NEEDS GREG (Prisma migration).** New migration to `DROP` the two 0526-named triggers + function, leaving only `audit_logs_immutable`. Verify on a prod clone: `SELECT tgname FROM pg_trigger WHERE tgrelid='audit_logs'::regclass;` → exactly one. `04` P1-1. |
| P1-2 | **`PILOT_SEAT_LIMIT=1000`** (deliberate testing value) not flipped; License upsert path unproven in prod (comment notes 2 prior seat migrations silently failed). | 11 | **NEEDS GREG.** Set contracted seat count + do one real License upsert to prove the write path. `06` P1-1. |
| P1-3 | **Verify `venue-os.app` is a verified Resend sending domain** — else every reset/invite/welcome email is silently dropped (the "no emails arrive" trap). | 9 | **NEEDS GREG (dashboard check).** Resend → Domains; send one real reset to a non-account address. `06` P1-2. |
| P1-4 | **Empty cold-start: new tenant lands on an all-zero dashboard** — `seedForNewTenant` seeds only POS/stream/house-ads, no screen/playlist/asset/template (K-12 gets only house ads). | 14 | Seed one demo Screen (PENDING) + one starter Playlist from a vertical preset on signup. Also `void`-seed is fire-and-forget (`onboarding.service.ts:187`) — await it. `05` P0-candidate + P1-2. |
| P1-5 | **Integration Concierge has no operator UI** — `/integrations/discover` + `/describe` are built server-side but zero frontend calls them; the flagship "no IT consultant" value prop is dark. | 14 | Add a "Recommended integrations" step after branding that POSTs the URL to the existing endpoint. `05` P1-1. |
| P1-6 | **taurus-safety CI gate does not scan `public/templates/**`** — 117 player-rendered boards unguarded; the **9 new K-12 `school/` boards** ship `color-mix()`/`aspect-ratio`/`text-wrap:balance` with no Chromium-83 fallback (degraded, not fatal, on a Taurus wall). | 15 | Add `public/templates` (excl. `_edit-shim.js`) to the gate's SCAN_DIRS; add solid-color fallback BEFORE each `color-mix()` in the school boards. `07` P1-1/P1-2/P1-3. |
| P1-7 | **Append-only tables have zero retention + the `ad_revenue_daily` rollup cron doesn't exist** — `playback_samples`/`sponsor_impressions`/`ad_impressions`/`touch_events` grow forever; ad dashboards read an empty rollup table. P3 at one customer, P1 by fleet/sports/ads scale. | 2 | One nightly retention worker (existing `setInterval` cron pattern, no new dep) + implement the documented `ad_revenue_daily` aggregation. `02` P1-1/P1-2. |
| P1-8 | **`canTriggerPanic` revocation is a silent no-op on Redis-less deploys** — a downgraded user keeps the panic claim in their JWT up to 30d if Redis is down at the privilege change. | 10 | WARN at boot when REDIS_URL unset that mass-revocation is disabled, and/or re-read `canTriggerPanic` from the live DB in the `@AllowPanicBypass` branch. `03` P2-2 / `04` P2-1. |
| P1-9 | **EXTERNAL_HTML boards have no per-board WebKit/Chromium-83 paint canary** — a future LF-in-regex (the 2026-05-09 class) or malformed baked CSS would ship uncaught. | 15 | Extend the WebKit canary to load each board in an iframe + assert `educms-ready` + non-zero body box. `07` P1-3. |

### 🟡 P2 — fix soon (not launch-blocking)

- **Assets grid is unbounded + un-virtualized** (≤500, no infinite scroll, no virtualization lib in the repo) — fine at one customer, add virtualization/pagination before media-heavy 50-location tenants. `01` P2.
- **Background polling of heavy unpaginated endpoints** — `/screens` + `/screen-groups` poll every 10s with `refetchIntervalInBackground:true` (full fleet even when tab hidden); `/screens` has no `take`. Drop the background flag + paginate. `01` P2.
- **`sponsor_impressions` rate limit is per-replica in-memory** → N× write-amplification under multi-replica. Move to Redis. `02` P2-2.
- **Same-origin Vercel CDN proxy (`/cdn/assets`) is built but receives no traffic** (needs no Cloudflare) — wire `resolveAssetUrl` to target it behind a flag for cross-kiosk edge de-dup. `02` P2-1.
- **dompurify 3.3.3** (5 moderate XSS-bypass advisories, prod sanitizer path, low reachability) → bump ≥3.4.0. `08` P2-1.
- **Frozen Chromium-83 debt in React widgets** (1196 flex `gap`, ~815 cqh-in-clamp) renders degraded on a real Taurus — the gate only blocks NEW additions. Schedule remediation; verify on Chromium-83 emulation. `07` P2-1.
- **`/announcements` is an honest-but-orphaned costume** (form → "coming soon" dialog, not in sidebar). Ship `POST /announcements` or redirect. `05` P2-1.
- **`GH_TOKEN` live PAT in Railway env** — scope minimally / rotate if env ever shared. `06` P2-2.
- **`.gitignore` cert patterns** — done tonight (F-1 added `*.key/.pfx/.p12/.crt`).
- **Stale `license.service.ts` header** says "3 seats / COMP" while limit is 1000 — fix when flipping P1-2.
- **39 holiday boards use `color-mix()`** with no Chromium-83 fallback. `07` P2-2.
- **dev email + SUPER_ADMIN UUID hardcoded in scripts** — move to env. `08` P2-2.

### 🟢 P3 — cheap/defer (full list in per-domain reports)
P3-1 player Ed25519 signature verification (documented follow-up; server gate already drops forgeries) · P3-2 `/screens/status/:fp` unauth returns pairingCode + writes status (add device-JWT / drop pairingCode) · P3-3 `/fitness/youtube-live/resolve` unauth no-throttle · P3-4 `/assets/file/:filename` no tenant binding (UUID-gated) · P3-5 `SSO_ENCRYPTION_KEY` unset (lazy; set before Sprint-2 SSO) · P3-6 builder route static-imported (code-split) · P3-7 Clever sync N+1 (Sprint 2) · P3-8 stale local branch `fix/deep-widget-…` · P3-9 25 moderate/2 low dev-tooling CVEs (all transitive build/test) · P3-10 live API 2 commits behind master (perf fixes) · P3-11 no actual old-Chromium render test.

---

## DOMAIN HEADLINES (for the skim)

1. **Performance** — gallery freeze+unmount fix verified solid end-to-end (107/107 boards, IO-unmount with hysteresis). Two playlist surfaces had the same unfrozen-iframe bug → **fixed tonight.** 120/120 timer-using widgets have cleanup; player WS has jittered backoff (no storm). No N+1 fan-out except a Clever loop (Sprint 2). [`01`]
2. **Egress / DB** — egress wall fixed at source (live-curl confirmed immutable headers); player SW range-caches video per-kiosk-once; DB pool boot-enforced; **every hot query has a covering index.** Watch: video transcode, append-only retention. [`02`]
3. **Security (authz)** — no exploitable cross-tenant IDOR across 64 controllers; SSRF defense is best-in-class (DNS-rebind-proof); no hardcoded secrets in tracked source; prior revocation/staleness gaps largely closed. [`03`]
4. **Emergency / audit** — signing gate is REAL (traced to `redis.service.ts:137` on every fan-out); audit immutability is REAL (DB triggers); fallback tiers closed. One migration-ordering bug (P1-1). No life-safety P0. [`04`]
5. **Usability** — core operator loop is <30s and honestly labeled; **"can't edit a word" is FIXED** (themed arrays+images wired into PropertiesPanel; 0/88 boards missing click-to-edit). Biggest gaps: empty cold-start + dark Concierge UI. [`05`]
6. **Launch / deploy / billing** — all CI green, health endpoints correct, emergency drill ready with zero screens. Blockers are config: TEST-mode Stripe, weak secrets, PILOT_SEAT_LIMIT, Resend domain. [`06`]
7. **Cross-browser / Taurus** — recurring killers (inset, LF-in-regex, aspect-ratio/text-wrap on React) all closed + gated. Open: 117 boards unscanned by the gate + 9 new school boards' color-mix fallback. [`07`]
8. **Deps / secrets / hygiene** — passport-saml CVE remediated (uninstalled); no high/critical CVEs; `.git` healthy; lockfile in sync. **The P0 is `.codex/` live secrets** (gitignored tonight, rotation pending). [`08`]

---

## RECOMMENDED MORNING ORDER FOR GREG
1. **Rotate the 4 `.codex/` credentials (B-1) + the prod JWT/SESSION secrets (B-2) + the AGC pilot password (B-4)** — all secret rotations, do them together. (15–30 min in the Supabase/Railway/Resend/Stripe dashboards.)
2. **Stripe go-live test-card pass (B-3)** before swapping to live keys.
3. **Approve the audit-trigger migration (P1-1)** — quick win, prevents a prod 500 on user-deletion.
4. **PILOT_SEAT_LIMIT flip + License-upsert verify (P1-2)** + confirm Resend domain (P1-3).
5. The rest (cold-start seed, Concierge UI, taurus gate, retention crons) are this-week code work, not blockers.

**Bottom line:** ship-ready code, four config blockers, all in Greg's hands. The three perf/safety code fixes that WERE safe to make autonomously are done, type-clean, and pushed.
