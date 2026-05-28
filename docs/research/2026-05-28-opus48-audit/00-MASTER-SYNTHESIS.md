# VenueOS — Opus 4.8 Full-App Audit — MASTER SYNTHESIS

**Date:** 2026-05-28 · **Method:** 9 read-only Opus 4.8 agents, all 21 Standard
Audit Surface sections, every claim verified against reality (curl / trace-the-caller
/ grep) per the 2026-05-21 "exhaustive or worthless" standard. Per-domain reports:
`01-02`, `03`, `06-08`, `09-12-13`, `10-11`, `14`, `15-18`, `16-17`, `19` in this folder.

---

## THE ONE-PARAGRAPH TRUTH
The **spine is genuinely solid** — and verifiably so, not on faith. The emergency
signing/HMAC chain that was "theater" in past audits is now real (traced to live
callers, `ws_signer:ok` in prod). Auth + billing is hardened: no exploitable P0,
PCI-SAQ-A clean (zero card data anywhere), seat-enforcement provably correct under
concurrency. The Chromium-83 defense is two self-detecting runtime polyfills + a
ratcheting CI gate. Vertical *plumbing* (copy/labels/branding/billing) is A-grade and
leak-free. Square POS and CTS Gen 6 are production-grade reference integrations. **The
problems are real and they cluster in five places:** (1) the **breadth** of integrations
— only ~3 of ~30 clickable providers are wired end-to-end, several are outright
costumes; (2) **12 themed widgets** ship as templates but can't edit their own content
— Greg's "can't edit a single word"; (3) **two life-safety holes on the fallback tiers**
that pass a Chrome-tab demo and die in the field; (4) **forensic theater** — the global
audit interceptor only logs to stdout, and login/templates/sponsors write no audit row;
(5) **vertical content depth** — 10 of 12 verticals have no builder palette tiles and
WORSHIP ships empty. None of these are rotten-core problems. All are fixable, most cheaply.

---

## PAGE 1 — COVERAGE TABLE (all 21 sections × D / UX / F)

| § | Domain | D | UX | F | Verdict |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | A | A | **B** | Signing solid; **P1 fallback-tier SOS/broadcast delivery hole** |
| 2 | Storage + content pipeline | A | A | **B** | Egress fix real; **P0 emergency media never caches** |
| 3 | AI providers × entry points | A | A | **B+** | Text-gen mapping solid; alt-text forks quota logic; multi-replica cap |
| 4 | AI feature surfaces | A | A− | **B** | Sparkle/touch/alt-text real; image-gen/translation/TTS N-A |
| 5 | AI comparative scan | — | — | **C+** | Ahead on copy-gen; behind on AI image + translation (HIGH gaps) |
| 6 | Streaming integrations | B+ | B | **C+** | Widget real (YT/Twitch/HLS); provider catalog oversells; RTSP/NFHS not built |
| 7 | Sports-data integrations | A− | B+ | **B** | CTS + generic /feed real; Daktronics/Nevco/Sportzcast costume/COMING_SOON |
| 8 | POS / commerce | B+ | B | **C** | Square real; 6 others NOT-STARTED; **custom-webhook → 404** |
| 9 | Communications | A | B+ | **B** | Email production-grade; webhook narrow + no retry; SMS/Slack/push honest N-A |
| 10 | Auth + identity | B+ | B | **B** | Hardened, no P0; **P1 role/panic staleness 30d** |
| 11 | Billing + commerce | A− | A | **A−** | Webhook/seat/PCI all real; pilot-seat-limit + trial-stub gaps |
| 12 | Design import | A | A | **C** | Single-page PDF/img real; Sprint-10 pipeline + Canva NOT built |
| 13 | Public alert | — | — | N-A | 100% genuine-future, correctly N-A, nothing inflated |
| 14 | Multi-vertical | A(plumbing) | B | **C(content)** | Plumbing leak-free A; **WORSHIP empty (F), 10/12 no palette tiles** |
| 15 | Cross-browser / Chromium-83 | A | B+ | **B** | Strong defense; 1 live `inset-[4%]` regression; WebKit coverage narrow |
| 16 | Forensic / audit coverage | — | B | **C** | Immutability+Stripe-replay real; **AuditInterceptor theater; login/templates/sponsor unaudited** |
| 17 | Operational + DX | A | A | **A−** | Health/CI/pool/secrets all real; multi-replica counters latent |
| 18 | Accessibility | A | A− | **B+** | Brand-AA/pins/panic real; **desktop emergency console silent for SR** |
| 19 | Template + widget editability | A | B | **C** | Most widgets A; **12 themed widgets can't edit content (D) — the complaint** |
| 20 | Design/UX/Functionality lenses | — | — | — | Applied across all rows |
| 21 | Verify-before-claim | — | — | — | Applied — every verdict traced to reality |

---

## MASTER RANKED FIX LIST (deduplicated across all 9 reports)

### 🔴 P0 — life-safety, pure lies, launch blockers
| # | Fix | §  | File:line |
|---|---|---|---|
| P0-1 | **Emergency per-screen media never caches** — server ships SW a URL-derived hash the SW recomputes-from-body + rejects; per-screen tier ALWAYS synthesizes. Screen degrades to text-only + re-downloads every 5min forever. Fix: ship real `Asset.fileHash` (or `sha256:null` + SW skip). | 2 | `screens.controller.ts:3236,3271` × `sw-player.js:491-505` |
| P0-2 | **SOS/TEXT_BROADCAST/MEDIA_ALERT never reach kiosks when WS is down** — manifest omits EmergencyMessage; SSE consumer has no handlers; `EmergencyOverlay` polls `/emergency/status` with a session cookie a kiosk lacks → live `401`. Fix: device-JWT `/emergency/status` variant + SSE handlers. | 1 | `EmergencyOverlay.tsx:75-78`; `player/page.tsx:3467-3490` |
| P0-3 | **12 themed widgets can't edit their content** (menu items, schedule rows, attendance, food photo) — `THEMED_WIDGET_FIELDS` lists labels, omits array/image fields. **Greg's "can't edit a single word."** Fix: array+image field renderers in the THEMED handler (or make it dynamic like ExternalHtmlTextEditor). | 19 | `themed-widget-defaults.ts:229-250`; `PropertiesPanel.tsx:4641` |
| P0-4 | **`AuditInterceptor` is theater** — claims FluentBit→S3, only `logger.log` to stdout; **login + all template mutations + sponsor (revenue) mutations write NO AuditLog row.** Fix: write real rows for uncovered privileged actions; AUTH_LOGIN_SUCCESS/FAILED. | 16 | `security/audit.interceptor.ts`; `auth.controller.ts:36`; `templates.controller.ts` |
| P0-5 | **`custom-webhook` POS advertises an endpoint that 404s** — the BYO-POS escape hatch is a dead link. Fix: build `POST /api/v1/pos/webhook/:providerId`. | 8 | `settings/pos/page.tsx:332` vs `pos-oauth.controller.ts:173` |
| P0-6 | **Daktronics/Nevco RS485 dropdown writes a field nothing reads** — pure costume (Greg's exact words). Fix: hide it until a decoder exists, or build the Daktronics decoder. | 7 | `WiringPanel.tsx:71-75` |
| P0-7 | **WORSHIP vertical sold on marketing page, ships ZERO templates** → empty gallery on signup. Fix: build `worship-presets.ts` OR pull WORSHIP from showcase/signup. | 14 | `verticals.ts:67` vs `apps/api/src/templates/*` (0 hits) |
| P0-8 | **`high-school-athletics.tsx:37` `inset-[4%]` live Taurus regression** — badge collapses to 0×0 on the LED controller. Fix: longhand `top/right/bottom/left-[4%]` + add `inset` pattern to taurus-safety gate. | 15 | `themes/high-school-athletics.tsx:37` |

### 🟠 P1 — real harm, high-leverage
| # | Fix | §  |
|---|---|---|
| P1-1 | **Role/`canTriggerPanic` staleness** — revoked panic capability keeps working up to 30d (JWT claim never re-checked vs DB; no cross-user revoke). Fix: revoke target tokens on downgrade. | 10 |
| P1-2 | **10 of 12 verticals have ZERO builder palette tiles** — QSR/retail/bar can't drag a fresh menu board; widgets exist + render, never registered. **Single highest-leverage fix — unblocks 10 verticals at once.** | 14 |
| P1-3 | **`RESEND_API_KEY`/`EMAIL_FROM` undocumented + default sender (`onboarding@resend.dev`) only delivers to account owner** — almost certainly the root cause of "no bug emails." Fix: document + verify a sender domain. | 9 |
| P1-4 | **JWT revocation gated on `NODE_ENV==='production'`** — logout/revocation are no-ops in any non-prod/misconfigured deploy. Fix: un-gate. | 10 |
| P1-5 | **Webhook has no retry queue** — `emergency.triggered` to a receiver down for 8s is lost permanently. Fix: 3-retry backoff for `emergency.*`. | 9 |
| P1-6 | **Clover marked DIRECT/ready, connects, never syncs** — worst kind of lie. Fix: build the handler or downgrade to PARTNER. | 8 |
| P1-7 | **Alt-text quota detection forks the shared helper, broken coverage** (no Anthropic 429, no Google) — out-of-credit silently swallowed. Fix: route through `mapProviderQuotaError`. | 3 |
| P1-8 | **No License↔Stripe reconcile cron** — event-driven fire-and-forget; any failed call drifts Stripe quantity permanently. Fix: daily reconcile pass. | 16 |
| P1-9 | **Desktop emergency console silent for screen-reader users** — no aria-live on hold/send/result. Fix: mirror the panic-page live region. | 18 |
| P1-10 | **QSR/RESTAURANT split starves full-service** — 19 rich presets walled to QSR, full-service RESTAURANT sees only 10. Fix: dual-tag. | 14 |
| P1-11 | **Sports gallery thin (~11 templates vs the 6-category ambition)** — most category tabs render near-empty. Fix: build per-sport scoreboard/celebration/sponsor presets. | 14 |
| P1-12 | **WebKit coverage stops at 18 static holiday HTMLs** — ~250 React widgets + the sports celebration pack untested in Safari. Fix: widget-render WebKit smoke spec + add celebrations to the canary. | 15 |
| P1-13 | **SERIALIZABLE pair tx not wrapped in `withDbRetry`** — seat-race loser gets a 500 instead of a clean 402. Fix: wrap it. | 11 |
| P1-14 | **AI platform free-tier hourly cap multi-replica-unsafe** — N replicas → N×30 (security boundary, not just UX). Fix: Redis counter. | 3/17 |

### 🟡 P2 — competitive, polish, latent
- **AI image generation** (competitive HIGH — OptiSigns/Canva ship it) — §5
- **AI translation** (competitive HIGH — V2 multilingual emergency depends on it) — §5
- No auto-seed sample data on signup (any vertical) — §14
- Per-vertical AI system prompts (sports/healthcare/corporate tone) — §3/§14
- Multi-replica abuse counters (branding scraper, AI failure) → Redis before scaling — §17
- AI: temperature parity, prompt caching (1 of 6 sites), stale model catalog — §3
- TOTP per-code replay lock; pilot-seat-limit=1000 vs documented 3; `activateTrial` stub — §10/§11
- Sprint-10 PDF page-split + PPTX pipeline; Canva Connect OAuth — §12
- Menu dayparting; IPTV `.m3u`; bundle dashjs; Atmosphere TV — §6/§8
- `rotation` + zone `opacity` on the Zone model — §19
- Per-field StyleableField for MS/Fitness packs — §19
- backdrop-blur solid-bg fallback verification (40 instances) — §15
- emergency cache 80%-floor warning; RBAC guard scopeId no-op — §1/§2
- Documented webhook events that never fire (screen.online/offline) — §9
- Retail sig-pack; FASHION⊂RETAIL cross-tag; stale Canva `/settings/imports` doc path — §12/§14
- WebView-version floor + telemetry on kiosk APK; ratchet axe warnings; keyboard-nav E2E — §15/§18

---

## RECOMMENDED FIX-WAVE PLAN
- **Wave A (P0, this week):** P0-1, P0-2 (life-safety) → P0-3 (widget content — Greg's
  complaint) → P0-4 (audit theater) → P0-5, P0-6 (integration lies) → P0-7 (WORSHIP) →
  P0-8 (Taurus regression — 1 line). Worktree-isolated agents, lead owns merge.
- **Wave B (P1):** lead with P1-2 (palette tiles — unblocks 10 verticals) + P1-1 (panic
  staleness) + P1-3 (email config). Then the rest.
- **Wave C (P2):** competitive (AI image/translation), polish, latent multi-replica.

Each wave: same protocol as T1/T2 — worktree isolation, relative paths only, commit to
own branch, lead reviews diff + runs tsc/jest + cherry-picks + pushes. Verify-before-claim
on every "fixed."
