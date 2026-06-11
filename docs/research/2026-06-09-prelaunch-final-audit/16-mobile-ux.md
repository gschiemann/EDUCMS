# 16 — Dedicated Mobile UX Audit (dashboard + panic) vs LIVE venue-os.app

**Date:** 2026-06-10 (overnight run)
**Auditor:** prelaunch-final-audit agent 16 (frontier-model fresh pass)
**Method:** Node Playwright scripts (`/tmp/mobile-audit/audit{,2,3}.cjs`) requiring
`@playwright/test` from the repo's `apps/web/node_modules`, driven against
**https://venue-os.app** (live prod). Browsers: **Chromium + WebKit**, viewports
**390x844** and **360x800**, `isMobile + hasTouch`. ~30 screenshots in `/tmp/mobile-audit/`.
Account: `admin@springfield.edu` — **verified CONTRIBUTOR on the live DB**
(`SELECT role FROM users…` → CONTRIBUTOR; the local seed's SUPER_ADMIN role for this
email does NOT match live), tenant `springfield-elementary` (3 screens / 12 assets /
12 playlists). No emergency was triggered, no SUPER_ADMIN used, no live data mutated
(wizard exited before Create; upload dialog opened with no file; nothing saved).

Console-error and 401 counts, element rects, off-screen/overlap/sub-44px scans were
collected programmatically per page (`findings{,2,3}.json` in `/tmp/mobile-audit/`).

---

## Coverage table (assignment workflows × Design / UX / Functionality)

| # | Workflow | Coverage | D | UX | F | One-liner |
|---|----------|----------|---|----|---|-----------|
| 1 | Login (incl. EULA gate) | covered | A- | B- | A | Clean; EULA-disabled button is a touch trap |
| 2 | Dashboard | covered | A | A- | A | Bottom tab bar, greeting, Right-Now — genuinely good |
| 3 | Screens tab (#217) | covered | A- | B+ | A- | Popover now viewport-pinned; #217 not reproducible |
| 4 | Fleet map | covered | B+ | B | B+ | Tiles + stats render; map below fold; 30px zoom controls |
| 5 | Assets + upload sheet (#215-class) | covered | A- | A- | A | Bottom-sheet folder picker, nothing clipped |
| 6 | Playlist wizard steps 1–5 (#215) | covered | A | A- | A | All 5 steps fit 390/360; full-screen picker; #215 fixed |
| 7 | Templates gallery + preview | covered | A | B | B- | Preview modal great; **Customize = silent no-op (CONTRIBUTOR)** |
| 8 | Template **builder** on mobile | deferred | — | — | — | Unreachable in walk (Customize no-op); no mobile-block guard exists in code |
| 9 | Settings | covered | A- | A | A | Honest "Admin Access Required" empty state for CONTRIBUTOR |
| 10 | /panic hold-to-trigger | covered | A (code) | **F (non-admin mobile)** | **D** | Valid session bounced to login; redirect param then dropped |
| 11 | Cross-cutting (tap targets, a11y, console noise) | covered | — | B- | — | 9 focusable-while-aria-hidden drawer items; 26px delete buttons |

Scoped down: builder canvas interaction (blocked by finding F-5), WebKit re-pass of
runs 2–3 (run 1 showed pixel-level Chromium/WebKit parity on every metric, so runs
2–3 ran Chromium-only), real-device touch (emulated touch only), MFA/SSO login paths.

---

## FINDINGS

### F-1 (P1) — /panic bounces a VALID logged-in session to the login screen for non-admin roles
**The emergency moat's mobile surface is unreachable for exactly the delegated-staff persona it exists for.**

Reproduced **5/5** across Chromium 390/360 + WebKit 390: log in → token present
(`sessionStorage['edu_cms_token']`, 357 chars, verified on-page) → `goto /panic` →
lands on `/login?redirect=/panic` **with the token still in sessionStorage**.

Root cause (traced, then confirmed with curl):
- `apps/web/src/app/panic/page.tsx:161` probes the session with
  `fetch(${API_URL}/users)` — but `GET /users` is **role-gated**:
  `apps/api/src/users/users.controller.ts:99-100`
  `@RequireRoles(SUPER_ADMIN, DISTRICT_ADMIN, SCHOOL_ADMIN)`.
- Live curl as CONTRIBUTOR: `GET /api/v1/users → 403 {"code":"Forbidden",…}`.
- `res.ok` is false → the entire `if (res.ok && storeUser)` block (which contains the
  correct `hasPanicAuthority()` → `'unauthorized'` phase) is skipped → fallthrough at
  **`panic/page.tsx:193` → `router.push('/login?redirect=/panic')`**.
- The catch-path (network error) DOES handle the unauthorized phase; the in-try
  non-ok path does not — 403 ≠ exception.

Blast radius: CONTRIBUTOR + RESTRICTED_VIEWER (live: 4 users today, **0 users have
`canTriggerPanic=true`**, and current pilots log in as DISTRICT_ADMIN — which is why
no human has hit it). But the K-12 pitch is *teachers* (CONTRIBUTOR +
`canTriggerPanic`) holding a panic button on their phone: for that persona the page
is hard-broken — they get told to re-enter a password mid-lockdown, and even a
CONTRIBUTOR who *should* see the polite "you don't have panic authority" screen
(built at `panic/page.tsx:167-171`) never reaches it.

**Fix (small):** probe a role-free endpoint (`/auth/me` / `/users/me`) instead of
`/users`; or treat any 401/403-with-token-present as "session ok" and let
`hasPanicAuthority()` decide the phase. Add a Playwright check: CONTRIBUTOR + /panic
must render `'unauthorized'` (or `'idle'` when `canTriggerPanic`), never `/login`.

### F-2 (P1) — Login drops `?redirect=/panic`: after re-login the user lands on the dashboard, not /panic
`apps/web/src/app/login/page.tsx:89-98` — the 2026-05-03 cross-tenant-bleed fix only
honors `redirect` if it is `/` or starts with `/${userSlug}/`. `/panic` is a global,
tenant-free route → silently rejected → hard-redirect to the dashboard. Live-verified
(run 3): re-login from `/login?redirect=/panic` → `…/springfield-elementary/dashboard`.
Combined with F-1 this is a loop: panic → login → dashboard → retype /panic → login…
**Fix:** add an explicit allow-list of global safe routes (`/panic`) to the redirect
validation (it's tenant-free by design; no cross-tenant bleed possible).

### F-3 (P2) — EULA gate makes the Sign-in button silently dead on touch devices
The submit button is `disabled` with only `title="You must accept the EULA to sign
in"` (hover tooltip — **invisible on touch**). The fallback error copy at
`login/page.tsx:182-186` lives in the submit handler, which can never fire while the
button is disabled. A phone user who misses the 16x16 checkbox (`w-4 h-4`,
`login/page.tsx:371-375`) taps a dead button with zero feedback. (This also broke my
first automated pass — fitting.) **Fix:** keep the button enabled and surface the
existing error on tap, or show an inline hint when tapped-while-disabled. Bonus: the
checkbox itself is 16x16 (label text is tappable, which mitigates).

### F-4 (P2) — Off-canvas nav drawer: 9 focusable controls while `aria-hidden="true"` (WCAG class)
When closed, the drawer (fixed panel parked at `left:-288..0`, z-40, present on every
authed page) keeps "Close navigation menu", "Dashboard", "Screens", … "Sign out"
(44x44) at `tabIndex=0` inside an `aria-hidden="true"` ancestor, not `inert`
(measured live: `{label:'Dashboard', tabIndex:0, ariaHidden:true, inert:false,
vis:'visible'}` ×9). Keyboard/AT users can focus invisible off-screen controls —
including **Sign out**. Drawer itself opens fine via the 40x40 hamburger and looks
clean (R3-drawer-open.png). **Fix:** `inert` (or `tabIndex=-1` + `visibility:hidden`)
on the closed drawer. Sweep the class: any translate-offscreen panel.

### F-5 (P2) — Templates "Customize" is a silent no-op on mobile as CONTRIBUTOR; builder unreachable
Preview modal is excellent (full-screen, "Animated Rainbow · Welcome, 3840×2160 · 1
zones", Close + Customize). Tapping **Customize** produced no navigation, no spinner,
no toast within 5s (url stayed `/templates`, 2 runs). Likely the preset-clone call is
RBAC-rejected for CONTRIBUTOR and the rejection isn't surfaced — same
silent-failure class as the audited "save failed" fixes. Consequence: the builder
(`/templates/builder/[id]`) was never reachable in this walk, so mobile builder
layout remains **unverified** — and note there is NO deliberate mobile-block guard in
the builder code (grep found none), so a phone user who does get in will meet the
desktop 3-panel layout. **Fix:** surface the error (toast + disable-with-reason), and
decide the mobile-builder stance explicitly (block-with-message or audit it).

### F-6 (P2) — Destructive "Delete playlist" tap targets are 26x26 on the mobile list
Measured live on /playlists: `{"label":"Delete playlist __editor_review_test__",
"w":26,"h":26}` (every row), beside a 44x24 toggle. Sub-44px destructive control on
touch = accidental-tap risk (confirm dialog presumably exists, still poor ergonomics).
Same sweep: Leaflet zoom 30x30, segmented List/Map/Floor-plans 117x32, filter chips
34-38px tall, wizard Back/Cancel/Next 36px tall, login footer links 15-17px tall,
bell/avatar 36x36. None hidden or clipped — pure ergonomics.

### F-7 (P3) — `/branding/me` fired without auth on login/marketing pages; 58-61 console errors per session
2 × 401 per fresh visit (response-counted), plus repeated console noise
(`[api] Request failed … /branding/me, Error: Unauthorized`) — acknowledged as a
known race in `apps/web/src/lib/api-client.ts:128-135` but still wasted round-trips +
console spam that would alarm any IT evaluator who opens devtools. Gate the query on
token presence.

### F-8 (P3) — Fleet map: actual map sits below the fold on phones; tenant with 0 geocoded screens shows LOCATIONS 0
Map tab works (CARTO/Leaflet tiles + attribution render; stats cards LOCATIONS 0 /
"3 devices" / OFFLINE 3). On 390x844 the operator sees only stat cards without
scrolling; the map needs a scroll to reach, and zoom controls are 30x30. Springfield
has no screen/tenant lat-lng so the map is pin-less (relates to pending task #60
back-fill). Minor: consider auto-scroll to map or compact stats on mobile.

---

## KNOWN-OPEN tasks #215 / #216 / #217 — verified current state

- **#215 media picker toolbar over top nav, hides Upload/Cancel → NOT REPRODUCIBLE (fixed).**
  Wizard Step 2 "Pick content" is now a full-screen dialog (0,0→390,844): folders chip,
  search, type filters, 2-col asset grid, "0 selected" pill, Back/Cancel/Next pinned
  bottom — nothing floats over the nav, nothing hidden (B-wizard-step2.png; clipped
  count 0 across steps 2-5 at 390 AND 360). Assets upload = clean bottom sheet.
  Recommend closing #215.
- **#216 address picker not finding real US street addresses → PARTIALLY FIXED.**
  Live `GET /api/v1/geocode` (auth-gated, good) now returns `"provider":"google"`;
  exact house-number hit for `1600 Pennsylvania Ave NW` — but a realistic suburban
  query `419 Tilipi Run, Chapin, SC` returns the WRONG street (`E Island Run, SC
  29036`, no house number) as the only result. Google key works; quality gap remains
  for newer suburban streets, and only one candidate is surfaced (no list to pick
  from). Keep open, narrowed scope.
- **#217 screen settings drawer pushes off left edge → NOT REPRODUCIBLE (fixed).**
  Settings popover is `fixed w-64 … z-9999` pinned at left:12, top:12, right:268 —
  fully on-screen for FIRST and LAST cards at 390x844 AND 360x800 (B-screens-popover-
  {0,2}.png, C360-…). Caveat: tenant has only 3 screens; popover is viewport-fixed so
  list position no longer matters by construction. Recommend closing #217.

---

## What is genuinely SOLID on mobile (don't touch)

- **Bottom tab bar** (Home/Assets/Playlists/Screens/More) + hamburger drawer dual nav
  — proper native-feel mobile IA; every page fit with **zero horizontal scroll** on
  every page tested (hscroll=0 across 3 engines/viewports × 11 pages).
- **Playlist wizard 1→5** entirely phone-usable: type cards, full-screen picker with
  selection pill, reorder step, schedule step, review — Back/Cancel/Next always
  visible. This was task #95/#120's promise and it holds on a phone.
- **Screens tab**: List/Map/Floor-plans segmented control, Pair Screen/New Group,
  stat cards, "How to connect" steps, per-screen diagnostics popover with player
  version/push update/fingerprint/LED canvas — dense but all reachable.
- **Settings for CONTRIBUTOR**: honest "Admin Access Required" empty state + 2FA card.
- **Template preview modal**: full-screen, correct metadata, live-rendered thumb.
- **Panic page CODE quality** (for roles that reach it): 6-type 2x3 full-bleed grid,
  3s hold with pointer-capture + keyboard hold (WCAG 2.1.1), aria-live announcements,
  44px min buttons on auxiliary states — the trigger UI itself is well-built; the
  gate in front of it is what's broken (F-1/F-2).
- Chromium/WebKit parity: run-1 metrics identical across engines — no Safari-specific
  layout deltas found on these surfaces.

## Walk-blockers honestly disclosed
- CONTRIBUTOR could not exercise: panic trigger grid (by design + F-1), builder
  canvas (F-5), Pair Screen / New Group / Upload completion (mutation-forbidden).
  An admin-role re-walk of /panic idle-phase + builder is the residual gap; the
  fixes for F-1/F-2 are provable from code + the 403 curl regardless.
- Screenshots + raw JSON: `/tmp/mobile-audit/` (cr390-*, wk390-*, cr360-*, B-*, R3-*).
