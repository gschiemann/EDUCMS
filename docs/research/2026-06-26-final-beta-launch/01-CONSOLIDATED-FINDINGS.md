# FINAL BETA — Consolidated Findings (severity-ranked, all waves)

Rolls up every wave's per-agent reports (`agents/*.md`). Updated as each wave lands. **Fix phase is separate — Greg decides what to fix from this list.**

Running tally: **P0: 1 · P1: 17 open (+1 already fixed) · P2: 72** — **AUDIT PHASE COMPLETE** (Waves A + LIVE-AI + B + C+D+AI-full + E+F; all 21 Standard-Audit-Surface sections covered). Only LIVE-glass (live-emergency-on-real-LED) remains, gated on the webcam.

### 🔒 The TWO security items that need a decision (both lead-verified by curl)
- **[P0 · CD2-F1] POS webhooks 403 CSRF-blocked** (below) — bricks inbound POS. One-line EXEMPT_PATHS fix.
- **[P1 · F4-NEW-1] Login/auth per-IP rate-limiting is DEAD in prod** — credential-stuffing defense non-functional (below). Needs Redis-backed throttler.
Everything else is launch-credible. **Multi-tenant isolation — the #1 launch risk — is AIRTIGHT under live two-tenant exploitation (could not read/write/delete any of tenant-A's resources as tenant-B; all 403/404).**

## 🔌 INTEGRATION REALITY SCORECARD (Wave C+D — the "real or costume" answer)
Audited every integration domain in the Standard Audit Surface. **Verdict: 76 REAL · ~1 COSTUME · 39 NOT-BUILT/DEFERRED — the app is overwhelmingly real, not a costume.** Full per-provider tables in agents/CD1..CD6.md.
| Domain | REAL | COSTUME | NOT-BUILT | Note |
|---|---|---|---|---|
| **Emergency (§1,16)** | 28 | 0 | 1 | Most-hardened surface in the app. "Signed-WS is theater" finding is genuinely CLOSED (verifyWsHmac wired at redis.service.ts:137); AuditLog DB-immutability trigger; all 3 scopes reach poll-only kiosks. |
| **POS/commerce (§8)** | 4 | 1 | 5 | Square/Clover/Lightspeed/Shopify DIRECT + live per-location pricing. **1 P0** (webhook CSRF). |
| **Sports-data + streaming (§6,7)** | 19 | 0 | 9 | Water-polo score path REAL, HMAC-signed, deployed. Daktronics RS485 now a real 414-line decoder (#171 RESOLVED). NOT a costume. |
| **Comms + Auth/SSO/SIS (§9,10)** | 7 | 0 | 8 | Resend email + outbound webhook REAL; Twilio/Slack/Teams/push honestly COMING_SOON; auth is the strongest area (JWT-revoke fails closed, TOTP+OIDC real, SAML hard-gated off pending CVE). |
| **Design-imports + public-alert (§12,13)** | 4 | 0 | 10 | PDF+PPTX real editable parsing; public-alert honestly NOT-BUILT w/ EULA disclaimer — the dangerous "life-safety costume" does NOT exist. |
| **AI surface (§3,4,5)** | 14 | 0 | 6 | Every provider × surface wired to live API w/ shared error-mapping + AbortSignal + AuditLog. Zero costumes. |

---
## P0 — launch blockers
1. **[CD2-F1] POS webhooks are CSRF-blocked in prod — bricks inbound POS.** `POST /api/v1/pos/webhook/custom-webhook` and `/webhook/square` both return **403 CsrfError** (lead curl-verified: 403 on both; control `/billing/webhook` → 400, i.e. exempt + reaches controller). The POS webhook routes were never added to `csrf.middleware.ts` EXEMPT_PATHS (unlike billing/sports-feed/cts-snapshot/sponsor-impression). External POS systems send `X-Webhook-Secret`/Square-HMAC headers, not a cookie+CSRF token, so they're blocked before their own auth runs. **Fix = one-line addition to EXEMPT_PATHS (safe: these webhooks self-authenticate via HMAC/secret, same as the already-exempt webhooks).** Bricks the only no-credential POS path AND Square inbound.

---
## ✅ Fixed DURING the campaign (live-caught, shipped CI-green)
- **[LIVE-AI-1] AI image-gen landscape/portrait was 400-broken** — gpt-image-1 rejects the DALL-E size vocabulary the FE sent (`1792x1024`/`1024x1792`). Caught the instant I generated a Landscape image on Greg's live tenant. Fixed `06038352` (per-model size re-map + 3 regression specs), Railway redeployed, **re-verified live** (Landscape now saves, no error). Square always worked. *This is the one exception to "find-only" — it was a bug in a feature I shipped hours earlier that Greg was actively testing; fixed under his standing "you fix anything local that needs fixed."*

## P1 — fix before / right after launch

1. **[A3] Multi-tenant publish data-loss** — a CONTRIBUTOR staging a DRAFT schedule for the same `(playlistId, screenId)` an admin already has LIVE *silently hard-deletes the admin's active schedule*. Content integrity / cross-role footgun. **Closest thing to a P0 in Wave A.** (repro in A3-playlists-scheduling-publish.md)
2. **[A1] Branding adopt overwrites the org name with scraped marketing copy** — after adopting from e.g. starbucks.com, displayName becomes "Starbucks Coffee Company", tagline becomes the og:description verbatim; the operator's entered "Acme Stores" is silently replaced (editable lower in the wizard, but most won't scroll). Root: branding-scraper.service.ts:459-469.
3. **[A1] Onboarding branding wizard shows K-12 chrome to every vertical** — placeholder `yourschool.org` + "Try: Lincoln County / Harvard / Stanford" for Retail/Sports/QSR. A per-vertical example map exists but `/onboarding/branding` mounts `<BrandingWizard>` without the `vertical` prop.
4. **[A1] Stale retired domain in the onboarding live-preview** — preview address bar reads `edusignage.app/...` (product is venue-os.app) + hardcoded K-12 sample body. First-impression signals an old school product.
5. **[A1] Getting-started guide is entirely K-12** — `/guide/getting-started` cover says "new K-12 districts," chapters reference FERPA/cafeteria/teacher-of-week. Wrong for non-K12 verticals.

### Wave B P1s (template creation + editor) — full detail in agents/B1..B5.md
6. **[B5] AI multi-scene template-gen drops per-zone scene assignment → empty destination scenes.** `ai.service.ts:2514-2526` never copies `z.sceneId` into the sanitized output; `templates.controller.ts:1060` hardcodes `sceneId:defaultSceneId` for every zone. The AI creates N scenes but puts ALL content on scene 1 — destination scenes are blank. **This is the root cause of the empty "Concessions/Restrooms" scenes I saw live.** Compounded by →
7. **[B5] Player has no empty-scene fallback in the main render path** (`player/page.tsx:5411`, the "Nothing to show here" fallback exists only in TouchNavOverlay cross-template nav). An AI kiosk's buttons navigate visitors to a blank dead-end screen with no Back chip until the 60s idle timer fires.
8. **[B1] StyleDisclosure (the rich per-field text editor) is DEAD CODE.** `PropertiesPanel.tsx:6299` defines the font/size/B-I-U-S/line-height/brand-color/highlight editor but it has **zero JSX call sites** (`<StyleDisclosure` = 0 matches). Six in-file comments (e.g. 7357-7359) claim each HS/Holiday/themed field renders a "🎨 Style disclosure" that no longer ships; `StyleableField` renders only a plain TextField.
9. **[B1] Quick style bars lack line-height + alignment + brand-color presets** — per-field styling ships only via the canvas-click bottom bar, which is missing those controls (partial §19 gap; "edit a word's style" is incomplete vs the standard).
10. **[B4] "Athletics" category tab is dead** (`verticals.ts:328` → ZERO presets tagged `ATHLETICS`; the 4 real game-day boards are tagged `EVENTS`), **and the preset grid has no empty-state** (`page.tsx:1376`), so clicking Athletics shows a blank page with no explanation.
11. **[B4] No "no results" empty state** on the preset/system grid generally — any empty category/search silently vanishes the READY-MADE section (operator reads it as broken).

### Wave C+D P1s (integrations) — full detail in agents/CD1..CD6.md
13. **[CD2-F2] The "use Custom Webhook, it works today" copy is a lie** — the PARTNER-provider panel (Toast/Stripe/MINDBODY) tells operators to push their catalog through the Custom Webhook provider "above — it works today," but that path 403s (the P0 above). Every operator hitting a PARTNER provider is routed to a broken escape hatch. Fixing the P0 also fixes this. (`settings/pos/page.tsx:416`)
14. **[CD4-1] Task-list says TOTP MFA is "pending" but it's shipped + live** — full enroll/verify/disable/backup/challenge flow + login-page challenge UI ship (`mfa.controller.ts` 6 endpoints; `GET /auth/mfa/status` → 401 live). Task #50 stale → risks someone "building" it again or telling a customer it's missing. Hygiene, not a product bug.
15. **[CD4-2] Push (APNs/FCM) promise is one layer deeper than the code** — the comms-push row says "push to the mobile panic page when an emergency fires," but the mobile panic page captures no device registration token (`firebase-admin`/`expo` = 0 hits). Correctly `COMING_SOON`, so not a launch blocker, but when push IS built there's no token source yet.

### Wave E+F P1s (scale + security) — full detail in agents/E1, F4.md
16. **[F4-NEW-1] Per-IP rate-limiting is non-functional in prod — brute-force/credential-stuffing defense is DEAD. LEAD-VERIFIED.** Every `@Throttle` (login 10/min, signup 5/min, password-reset 3/hr, invite 20/min) never fires 429. My curl: 8 bad logins → all 401, **zero 429**, `x-ratelimit-remaining` bounced **9,9,9,8,8,8,9,8** (never decremented to 0). Root cause: in-memory `ThrottlerModule.forRoot` (`app.module.ts:175`) split across Railway replicas — each replica counts in its own memory, so no single bucket reaches the limit (compounded by `trust proxy 1` IP extraction, `main.ts:57`). **Fix = Redis-backed throttler storage (shared across replicas), same pattern as the AI hourly cap.** argon2 cost + AuditLog still apply; not a cross-tenant leak, but a public login with no working brute-force limit is a real pre-launch exposure.
17. **[E1-F5] Pilot seat limit is 1000 → billing metering effectively OFF (config-only, owner=Greg).** `PILOT_SEAT_LIMIT=1000` (`license.service.ts:33`) was raised from 3 for internal testing and never dropped; an HQ can pair unlimited screens with no billing ceiling, and the License↔Stripe reconcile no-ops because Stripe is unconfigured on the pilot. Launch-readiness/billing decision, not a bug.

### Watch-list (P1-adjacent config decision)
12. **[B3] Tier-1/Tier-2 AI budget safety is enforced by an UNSET env var, not by code.** Prod has NO `ANTHROPIC_API_KEY`, so no-BYOK tenants resolve to `source:'none'` and every Tier-2 action 503s honestly. **The moment that env var is set, ALL no-BYOK tenants flip to `source:'platform'` and the full sparkle silently bills our Anthropic key** (by design, 200/mo free cap — but it's a conscious one-env-var launch decision, not accident-proof). Flag before flipping it on.

## P2 — polish / hardening
- **[A1]** 401 on `GET /branding/me` immediately after auto-login (token-attach race; self-recovers, pollutes telemetry).
- **[A1]** Signup form is 10 fields when API needs 4; optional phone/address not progressively disclosed (long at 390px).
- **[A1]** Branding preview logo can show broken/CORS-blocked image on CORS-strict sites (adopt re-hosts fine; preview emits error burst).
- **[A2]** PDF detail slide-over shows "Preview not available" (generic icon) — never renders first page (grid tile does).
- **[A2]** Mobile bulk-select injects a tall 4-button block inline, pushing content.
- **[A2]** URL-asset mshots screenshot shows a placeholder until the CDN warms (first impression of a URL tile).
- **[A3]** Manifest returns the same playlist TWICE when a group schedule + per-screen schedule both target one screen (no precedence dedup).
- **[A3]** Windowed-schedule daysOfWeek/timeStart/timeEnd NOT enforced server-side (manifest filters only startTime/endTime/isActive).
- **[A3]** "One item on one screen" still walks the full 5-step wizard (~7 clicks); strong defaults mitigate (ties to the Appspace one-tap-publish idea).
- **[A4]** Gallery "Athletics" category tab is dead for K12 (0 presets tagged) → hides the ready-made grid.
- **[A4]** No "no results" empty state — empty search/category silently vanishes the READY-MADE section.
- **[A4]** (test-only, not a defect) Playwright can't cross the null-origin sandboxed iframe to fire click-to-edit — needs the in-app harness to verify.
- **[A5]** Empty manifest (NO_SCHEDULE) omits canvasW/H/orientation/repeats/hardwareModel that emergency+scoreboard+normal-play paths consume.
- **[A5]** Preview-mode "kiosk needs re-pairing" toast overlaps + clips the Auto-Play button.
- **[A5]** React #418 hydration error fires once on the player route (both Chromium+WebKit); render not broken (window-derived text at first paint — known #205-class).
- **[A5]** Player global layout fires `GET /branding/me` unauthenticated in preview → 401 every load (falls back fine).
- **[A5]** Screen gear-menu footer says "More coming soon — restart, orientation, cache clear" though orientation is already implemented in the same menu (stale copy).
- **[LIVE-AI-4]** AI template-gen double-encodes `&` → renders `Concessions &amp; Menus` literally on the board (same class as #61 HolidayWidget entity strings).
- **[LIVE-AI-5]** AI template-gen ignores the tenant brand palette even when the prompt says "use our brand colors" (output is white/black). Sparkle copy + image-gen DO weave brand in; template-gen doesn't.
- **[LIVE-AI-6]** K-12-flavored AI affordances on non-K12 tenants — template-gen suggestion chips ("Cafeteria menu / Library map / After-school programs") + image-gen placeholder ("back-to-school banner") on a Sports tenant. Needs a per-vertical example/placeholder map (same root as A1 K-12-chrome).
- **[LIVE-AI-7]** Chat-to-edit ("Edit with words") can propose a size that contradicts the instruction — "a bit larger" → 15px on a 24px element (smaller). Bold direction was correct; model likely lacks the element's current size as context.
- **[LIVE-AI-2 → A2]** Asset RESOLUTION metadata recorded at a downscaled ~320px width (590 KB image reads `320×941`) — misleads LED-canvas sizing. Belongs to assets/A2, not AI.

---
### Wave B grades (template creation + editor) — full reports agents/B1..B5.md
B1 widget-editability **A-/B+/B+** (every widget reaches a real editor — the "can't edit a word" complaint is FIXED; the gap is text-STYLE depth: dead StyleDisclosure + missing line-height/align/brand presets). B2 EXTERNAL_HTML boards **A-/A/A** (2026-06-07 un-editable-board fire fully contained; 0 P1, only doc-drift P2 — deployed prod matches repo; shim is now V6). B3 AI no-key degradation **A-/A-/A** (honest 503s, no 500s, no budget leak; the env-var watch-item above). B4 gallery/layout/x-browser **A-/B/A-** (Taurus surface clean; Athletics dead tab + no empty-state). B5 kiosk scene runtime **A-/C+/B-** (player scene runtime is REAL not a stub — goto-scene + Scenes tab + kiosk button-bridging all work; the AI-gen empty-destination-scene bug drags UX to C+).
**Wave B verdict:** the editor + boards + player scene runtime are genuinely real and editable (no costumes). The launch items are the AI-multi-scene sceneId bug (#6/#7), the dead StyleDisclosure (#8), and the Athletics dead tab (#10).

### LIVE AI track grades (Design / UX / Functionality) — **A- / A / A-**
Every AI surface is genuinely wired to a live provider and works end-to-end (image-gen, vision alt-text, template generation w/ real multi-scene GOTO-SCENE wiring, chat-to-edit diff-preview, sparkle 3-options w/ tone). Deductions are all P2 polish: entity-encoding, brand-palette-in-template-gen, K-12 copy, chat-edit size direction. Differentiated vs Appspace; not a costume. Full report: `agents/LIVE-ai.md`.

### Wave A grades (Design / UX / Functionality)
A1 signup/onboard/brand A-/A-/A · A2 assets/media A/A-/A · A3 playlists/scheduling B+ functionality (the data-loss P1) · A4 templates/editor A-/B+/A · A5 screens/player A-/A-/A-.
**Verdict:** core one-user journey is launch-quality; the cross-vertical copy/branding defaults (still K-12-flavored) + the schedule-overwrite bug are the real items.
