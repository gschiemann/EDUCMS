# Launch QA walkthrough — 2026-10-23

Branch `qa/launch-walkthrough`, PR #138. Local stack only: web dev on :3195 → API (built `dist/`) on :8095 →
scratch Postgres `qa_launch_1023` (`prisma migrate deploy` + seed) + Redis db 9. Nothing touched production.
Drivers: Playwright scripts (Chromium + WebKit, 1325×758 desktop, 390×844 iPhone UA) and
`audit-builder.mjs` (the 42-check builder harness) in WebKit.

**Status of this report: LIVE — updated after each fix group.** Flows marked *not yet tested* had not
been walked when this revision was written.

## Launch blockers (still open)

| # | Severity | Area (owner) | What | Repro |
|---|---|---|---|---|
| B1 | **P0** | Emergency — desktop Broadcast console `/[slug]/emergency/broadcast` (emergency owner; not changed per brief) | The page sends the **URL slug** as the tenant id. `POST /emergency/broadcast` and `/emergency/media-alert` go out with `scopeId: "springfield-elementary"` → **403 for every school admin** ("You do not have permission to trigger emergency actions for this scope") and 403 `SUPPORT_ACCESS_REQUIRED` for a super admin on their own school. The active-messages poll (`/emergency/status?tenantId=<slug>`) 403s for super admins, so the list of live broadcasts (and its Clear buttons) is always empty for them. This is the page the dashboard's red "Emergency console" button opens **during an active emergency**. | Local: make a SCHOOL_ADMIN with `canTriggerPanic` → `POST /api/v1/emergency/broadcast {"scopeType":"tenant","scopeId":"<slug>","text":"x","severity":"INFO","durationMs":60000}` → 403. Same body with the tenant UUID works. Code: `apps/web/src/app/[schoolId]/emergency/broadcast/page.tsx:95,177,185` use `params.schoolId`. **Confirmed in the real UI (WebKit, school admin):** "Broadcast failed. Your alert was NOT sent. Send failed: 403". **Ready patch, proven locally then reverted (not committed — emergency area):** `B1-broadcast-scope.patch` (uses `user?.tenantId`, the same source as `EmergencyTriggerModal.tsx:82`); with it applied the same hold returns 201 "Broadcast dispatched to all displays" for both the school admin and the super admin. The main LIVE/DRILL trigger modal is NOT affected. |
| B2 | P1 | Public `/security` page (public-pages owner) | `/security` is a 404 (title "Page not found"). Nothing links to it today, but the brief and sales material expect it. | `GET /security` → 404 in both engines. |

## Fixed on this branch

| Commit | What | Proof |
|---|---|---|
| `c61f9b08` | **Playlist wizard uploaded every file twice** (5 files → 10 uploads / 10 `complete-upload` / 10 library rows) under React StrictMode: `jobs.start()` ran inside a `setState` updater. | StrictMode unit test (fails on the old code — negative control run) + e2e `mobile-usability.spec.ts:339` asserts exactly 5 `complete-upload`. |
| `c61f9b08` | **Empty Playlists library had two buttons named "New playlist"** (header + empty state) — the cause of the `mobile-usability.spec.ts:339` flake (strict-mode violation when the empty list settled before the click; passes when the click lands during loading). Empty-state action is now "Create a playlist". | Unit test "never two controls with the same name"; e2e `:339` **20/20** (10 Chromium + 10 WebKit, `--repeat-each=10`). |
| `c61f9b08` | Playlist library header / empty / error / no-match copy now en/es/zh; root `<title>` + iOS home-screen title "VenueOS" (was "Venue OS"). | — |
| `886cd9db` | **SSO settings page could never load or save**: read `localStorage.auth_token`, a key nothing has written since SEC-010 → every request "Bearer " → 401, shown as "Could not save the SSO configuration — Authentication token missing" on first open. Now uses the store token; a failed read says "Could not load…". | `screens/sso-BEFORE-chromium.png` vs `screens/sso-AFTER-webkit.png`. |
| `886cd9db` | **POS / Instagram / Facebook OAuth landing pages stranded the operator** on "HTTP 404" after a *successful* connection (`GET /me` does not exist + dead token). Instagram/Facebook (which land on the same page) were also told their "POS catalog" was syncing and bounced to POS settings, away from the builder. Now: workspace from the session, social returns to the page that started the connect (same-workspace paths only), signed-out → Sign in link; en/es/zh. | `src/app/connect/__tests__/connect-done.test.tsx` (5 tests incl. open-redirect guard). |
| `886cd9db` | `apiFetch` logged every **aborted** request as `clog.error` → a red Next "1 Issue" on every dashboard navigation in dev, and noise in every bug report's console capture. | `api-client-abort-quiet.test.ts`; SSO screenshot after shows no Issue badge. |

## Per-flow status

| # | Flow | Chromium | WebKit | Status | Notes |
|---|---|---|---|---|---|
| 1 | Sign up → trial | ✓ | ✓ | **PASS** | Signup → `/onboarding/branding` (welcome email + starter board + playlist seeded). See UX gaps U1, U2. |
| 1 | Sign in (2-step email → password + EULA) | ✓ | ✓ | **PASS** | |
| 1 | Password reset request | — | ✓ | **PASS (local)** | With no `RESEND_API_KEY` the page honestly says email isn't configured. Reset completion (token page) *not yet tested* — the dev stub doesn't log the link. |
| 1 | First-login setup (email code, passkey/authenticator, backup codes) | | | *not yet tested* | |
| 2 | Pair a screen (`/player` code → Screens → Pair screen) | ✓ | ✓ | **PASS** | Player shows "Screen Paired Successfully"; list shows the screen online. `screens/webkit-pair-after.png`. Rename / group *not yet tested*. |
| 3 | Media upload | | | **PARTIAL** | Local stack has no Supabase storage, so presign 500s — real uploads cannot be walked locally. Covered instead by the mocked-storage e2e (`mobile-usability.spec.ts`, which found the double-upload bug above) and the 10-04/10-05 media-matrix campaign. |
| 4 | Playlists wizard (phone) | ✓ | ✓ | **FIXED** | Double upload + duplicate control (above). Publish / reorder / schedule / replace / delete *not yet tested* on desktop. |
| 5 | Templates builder harness (`audit-builder.mjs`, WebKit) | | 37/43 | **PASS (harness drift)** | All 6 FAILs are the harness lagging the product, verified by screenshot/code: Scenes became a "Pages" strip (`ecdbee36`) → 2 fails; Brand empty-state copy changed ("Set up your brand / Open Brand & appearance"); Apps now adds the zone first and disables "Show it on the board" with a reason for a bad URL (product correct, harness looked for the old Add button); Width (%) field exists (`PropertiesPanel.tsx:1204`, behind the %/px toggle). One WebKit "Fetch API cannot load … access control checks" pageerror = an aborted fetch during navigation (WebKit words aborts that way). Findings JSON: `builder-findings-webkit.json`. See U4. |
| 6 | Emergency — DRILL (super admin) | | ✓ | **PASS** | Trigger modal → DRILL → Lockdown → type LOCKDOWN → Start Drill. `/player` (paired in a separate browser) shows "DRILL — THIS IS A DRILL / LOCKDOWN DRILL" ≤ 3.2 s after the hold; dashboard covered by "DRILL ACTIVE" with typed-CLEAR all-clear; player back to normal 2.6 s after "End Drill (All Clear)". `screens/player-drill-overlay.png`, `webkit-dashboard-drill-active.png`, `webkit-drill-confirm.png`. |
| 6 | Emergency — LIVE (school admin with panic capability) | | ✓ | **PASS** | Same path, "Trigger Emergency": player "EMERGENCY NOTIFICATION / LOCKDOWN PROTOCOL ACTIVE" ≤ 3.1 s; "Terminate Emergency (All Clear)" clears the player in 2.6 s. `screens/player-live-lockdown.png`. |
| 6 | Emergency — Broadcast / media alert (desktop console) | ✓ | ✓ | **BROKEN-not-mine (B1)** | 403 on every send; patch attached. SOS and media alert with real media *not yet tested* (media needs storage). |
| 6 | Emergency — a11y note | | | UX gap U7 | The trigger modal is not exposed as `role="dialog"` (Playwright `getByRole('dialog')` finds nothing); the active-alert overlay IS a proper `alertdialog`. |
| 7 | Settings crawl (40 routes, WebKit) | | ✓ | **FIXED (SSO)** | Every settings route renders 200 with no page errors after the fixes. Billing with Stripe off renders cleanly. |
| 8 | Public pages / help / pricing / legal / status | ✓ | ✓ | **PASS except B2** | 18 routes + 31 discovered links: no 404 except `/security`. `/status` shows storage 503 locally (no Supabase) — expected. |
| 9 | Mobile (iPhone width, WebKit) | | | *not yet tested* beyond the phone playlist e2e | |

## UX gaps vs. competitors

| # | Sev | Where | Gap |
|---|---|---|---|
| U1 | Medium | `/signup` (WebKit/Safari) | The "What are you running?" `<select>` renders as Safari's native 20px control next to 42px rounded inputs (`screens/webkit-public_signup.png` vs `chromium-public_signup.png`). 146 `<select>`s in `apps/web/src` and none set `appearance-none`, so every dashboard select looks this way in Safari (People: "All roles / All statuses" next to a 42px search). Needs a design decision (global `appearance:none` + chevron) — not changed here. |
| U2 | Medium | `/signup` | Whole page is English-only (no `useTranslations`) while `/login` offers en/es/zh. |
| U3 | Medium | Playlists library (`PlaylistLibraryV1.tsx`) | ~60 strings still hard-coded English (status tabs, filters, table headers, row menu). Only header/empty/error copy moved to i18n on this branch. |
| U4 | Low | Builder text toolbar | Font size shows unrounded values ("26.879"). |
| U5 | Low | `/reset-password/request` with email not configured | Says "Your account exists" — confirms an account to anyone (only when outbound email is unconfigured, i.e. not prod). |
| U6 | Low | Signup value prop | "170+ templates" — the catalogue is 493 presets / 286 boards. |
| U7 | Medium (a11y, emergency owner) | Emergency trigger modal | No `role="dialog"` / `aria-modal` on the Trigger Emergency / Start a Drill modal, so screen readers are not told a modal opened (the CLAUDE.md §18 emergency a11y bar). |
