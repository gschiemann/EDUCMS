# Mobile UX Audit — Slice 05: Dashboard + Global Navigation + Emergency/Panic

**Date:** 2026-05-29
**Auditor:** senior mobile-UX + front-end (read-only)
**Device matrix:** Playwright Chromium, iPhone-class UA, **390×844** and **360×800**, DPR 2, touch enabled
**Server:** isolated `pnpm --filter web dev` on **:3015** (default `.next`, Turbopack), admin session injected (`SCHOOL_ADMIN`, `canTriggerPanic:true`), all API mocked with credentialed-CORS-correct headers (Origin echoed into `Access-Control-Allow-Origin`, never `*`).
**Screenshots:** `scratch/mobile-ux-audit/dashboard-emergency-<vp>-NN-*.png` (16 states × 2 viewports = 32 files).

> **Verification discipline (CLAUDE.md §21):** Every grade below is backed by a rendered screenshot and, where measurable, a DOM `getBoundingClientRect()` / `getComputedStyle()` reading taken in the live browser — not by reading source. Two findings are exact pixel measurements (notification clip x=-43px; active-nav contrast indigo-on-indigo). One success state (panic "Broadcasted") could not be captured live because `broadcastEmergency` is a **server action** whose `fetch` runs server-side and bypasses Playwright route mocking — so the harness exercised (and verified) the real *failure* path instead, which is itself a critical life-safety surface. That surface passed.

---

## TL;DR

The mobile experience here is **above industry norm** — far better than I expected. The phone dashboard is a purpose-built `MobileDashboard` (not a squeezed desktop), the panic page is genuinely excellent one-thumb life-safety UX (144–159px hold targets, animated progress ring that works by touch, aria-live, immaculate failure copy), and the reviews page has had a real mobile pass. **No horizontal overflow anywhere** (scrollWidth == clientWidth at both 390 and 360 on every surface).

But there are **two P0 bugs** and a cluster of P1s that undercut the polish:

- **P0-A — Notification panel is clipped 43px off-screen left**, so every notification's first word is cut off (`-43px` measured, both viewports). The bell is the admin's primary "what needs me" surface and it's half-unreadable on a phone.
- **P0-B — The active nav item label in the mobile drawer is invisible** (measured: `color rgb(79,70,229)` text on `bg rgb(79,70,229)` — indigo-on-indigo, 0 contrast). The user can't tell where they are.
- **Emergency-specific:** the bottom tab bar stays **tappable over the active-emergency all-clear overlay** (overlay z-50 sits *under* tab bar z-60, and the tab bar doesn't hide on `isEmergencyActive`). Not life-threatening (overlay re-mounts per page) but it's emergency friction → I am ranking it **P0 per the brief's "emergency friction = auto-P0" rule.**

No console errors beyond the expected server-action `fetch failed` in the mock harness.

---

## Coverage table (Design / UX / Functionality at phone width)

Grades A–F. **≤ B is a gap.** Emergency surfaces held to a higher bar.

| # | Screen / surface | D | UX | F | One-line verdict |
|---|---|---|---|---|---|
| 1 | Login (`/login`) | A | A- | A | Centered, branded, EULA + SSO; "Sign in" button reads slightly disabled (lavender). |
| 2 | Dashboard — `MobileDashboard` | A | A- | A | Purpose-built mobile home; emergency hero leads, no overflow. |
| 3 | Bottom tab bar (`MobileTabBar`) | A | A | A | 6 tabs @ 65×56px, danger-red Alerts, unread badge, safe-area pad. Best-in-class. |
| 4 | "More" overflow sheet | A | A | A | Bottom sheet, Templates/Reviews/Audit/Settings/Account, clean. |
| 5 | Mobile drawer (`Sidebar`) | C | C+ | B | **Active label invisible (P0-B)**; also duplicates tab-bar + More-sheet nav. |
| 6 | Notifications bell + panel | C | **D** | B | **Panel clipped −43px off-screen left (P0-A)** — first word of every row cut. |
| 7 | Reviews (`/reviews`) | A- | A- | A | Real single-pane mobile push pattern, dvh, tab-bar clearance, 44px targets. |
| 8 | Emergency trigger modal (desktop modal on mobile, opened from drawer) | A- | B+ | A | Bottom-sheet, 2-col grid, typed-confirm; top type-row scrolls under header on first paint. |
| 9 | **Panic page idle** (`/panic`) | A | **A** | A | 6 SRP circles @159px (390) / 144px (360); zero overflow; perfect one-thumb. |
| 10 | **Panic hold gesture** | A | **A** | A | Animated ring works **by touch**; release < 3s cancels; 3s fires. Verified live. |
| 11 | **Panic triggered / failure** | A | A | A | Flawless "FAILED — alert NOT broadcast — NOTIFY SECURITY MANUALLY" + Try Again/Re-login. |
| 12 | **Panic unauthorized** (CONTRIBUTOR) | A | A | A | Amber "NO TRIGGER AUTHORITY" + manual-notify guidance + Switch Account. |
| 13 | Dashboard during ACTIVE emergency (`EmergencyOverlay`) | A | B- | A- | Full red takeover, type-CLEAR gate; **tab bar tappable over it (P0, emergency friction)**. |
| 14 | Top toolbar (hamburger / school switcher / bell / help / avatar) | A- | B+ | A | Dense but legible; avatar menu + help drawer fine; bell panel is the weak link (see #6). |

**Surfaces NOT in this slice** (owned by other audit slices, noted for completeness): assets/templates, playlists, screens/map, settings — separate `*-360/-390` screenshot sets exist in the same folder from parallel agents.

---

## Per-screen detail, problems, and file:line

### 1. Login — `apps/web/src/app/login/page.tsx`
**Screens:** `…-01-login.png`
Clean and centered at both widths. VenueOS hexagon, "Sign in to VenueOS", tagline, email (focused-ring visible) + password, Keep-me-signed-in, EULA checkbox with EULA link, full-width Sign in, "Sign in with SSO", footer nav. Email input width 300px@390 / 270px@360 — good.
- **Minor (P2):** the primary **"Sign in" button is rendered in light lavender** (`apps/web/src/app/login/page.tsx` button styling), which reads as a *disabled* state on a phone in sunlight. Compare to the saturated indigo used elsewhere. Bump to `--brand-primary` solid.
- a11y: `autoFocus` on email is a known TODO (line 1 comment) — acceptable.

### 2. Dashboard (mobile) — `apps/web/src/components/dashboard/MobileDashboard.tsx`
**Screens:** `…-02-dashboard.png`
This is the highlight of the slice. `DashboardPage` (`apps/web/src/app/[schoolId]/dashboard/page.tsx:296`) early-returns `<MobileDashboard/>` under 768px (`useIsMobile`, `apps/web/src/hooks/use-mobile.ts:3` = 768). Layout: greeting card → **red "Emergency triggers" hero** (358×95@390) → 2×2 quick-action chips (Upload asset / New playlist / Screens / Schedule) → "Right now" status rows (Screens online 4/5, Pending reviews 1, Assets 3) → "Playing right now". **scrollWidth 390 == clientWidth 390** (no overflow).
- Emergency hero (`MobileDashboard.tsx:121-139`) is gated `!isContributor && !isViewer` and links to `/panic?schoolId=…` — correct: contributors/viewers don't see a trigger entry they can't use.
- **Strong:** leading with emergency on the phone home is exactly the competitive differentiator the file's own header comment claims; it delivers.
- **P2:** the desktop dashboard (`page.tsx`) is a completely different, much richer fleet console (KPI cards, sites rollup, pending-approvals with inline Approve). The mobile version drops the **inline "Approve" affordance** for pending assets — a mobile admin can *see* "Pending reviews: 1" but must navigate to /reviews to act. Acceptable for v1, but a swipe-to-approve or inline approve would close the loop.

### 3. Bottom tab bar — `apps/web/src/components/layout/MobileTabBar.tsx`
**Screens:** `…-03-tabbar.png`
6 tabs (Home/Assets/Playlists/Screens/Alerts/More), each **65×56px** (>44px min), Alerts in danger-red with Siren icon, unread badge on Home, active underline + scale, `pb-[env(safe-area-inset-bottom)]`. This is genuinely best-in-class for a signage CMS.
- Correctly **hides itself** on `/panic`, `/player`, builder, auth, and — verified — when the drawer is open (`mobileSidebarOpen`, line 82) **and** when any overlay is up (`overlayOpenCount`, line 85). Measured `tabBarWhileDrawer = 0` at both viewports. 
- The 404-fix for Home href (`homeHref`, line 111) and the RBAC drop of Alerts for viewers (line 121) are both correct.
- **Gap (ties to P0 below):** `isHidden` does **not** include `isEmergencyActive`. During an active emergency the overlay renders but the tab bar stays on top of it. See P0-C.

### 4. "More" overflow sheet — `MobileTabBar.tsx:168-216`
**Screens:** `…-04-more-sheet.png`
Bottom sheet, `role="dialog" aria-modal`, backdrop tap + X to close, rounded-top, items: Templates, Reviews, Audit Log, Settings, Account (measured `moreItems` exactly that, RBAC-correct). Each row is a generous icon+label. Discoverable and sensible — this is the right pattern for nav overflow on a phone.

### 5. Mobile drawer — `apps/web/src/components/layout/Sidebar.tsx`
**Screens:** `…-05-drawer.png`, `…-05b-drawer-scrolled.png`
The hamburger opens the **full desktop sidebar** as a left drawer (`h-dvh w-72 max-w-[85vw]`, line 312). Backdrop + ESC + route-change close all present.
- **P0-B — active nav item label is INVISIBLE.** Measured on the active "Dashboard" row: `span color = rgb(79,70,229)` on `item background = rgb(79,70,229)` → identical indigo, **zero contrast**, label unreadable (also the icon barely shows). Root cause: `Sidebar.tsx:548` active class `bg-[color-mix(in_srgb,var(--brand-primary,#4f46e5)_8%,transparent)]` did **not** resolve to the intended 8% tint — it rendered as the *solid* brand color — while `Sidebar.tsx:551` sets the text to the same `var(--brand-primary)`. Tailwind v4 arbitrary `color-mix()` in a bracket class is the likely failure (it computed to the raw color, not the mix). Fix: use an explicit low-opacity background utility (e.g. `bg-indigo-50` / a real `--brand-primary-50` token) for the active state, OR keep the mix but force the label to `text-slate-900` / `var(--brand-ink)`. **Reproduces at 390 AND 360.**
- **P1 — three overlapping navigation systems.** A phone user reaches navigation via (a) the bottom **tab bar**, (b) the **More sheet**, AND (c) this **full drawer** — with Templates/Reviews/Settings appearing in *both* the More sheet and the drawer. The hamburger + drawer is largely redundant on a phone that already has a tab bar + More. Recommend: on mobile, either drop the hamburger entirely (let tab bar + More own nav) or repurpose the drawer for account/brand only. Right now it's three doors to the same rooms.
- **P1 — drawer footer Sign-out is a 28×28px icon button** (`Sidebar.tsx:645`, measured `drawerSignout 28×28` @360). Below the 44px touch minimum, and it's the only sign-out on this surface. Enlarge the hit target.
- **P1 — drawer Emergency button is 32px tall** (`Sidebar.tsx:598`, measured `drawerEmergencyBtn 126×32`). For a life-safety control this is small; bump to ≥44px. (It's a *third* path to emergency — see Reachability below.)
- a11y: drawer nav items never set `aria-current` (only the tab bar does). Minor.

### 6. Notifications bell + panel — `apps/web/src/components/layout/NotificationsBell.tsx`
**Screens:** `…-07-notifications.png`
Bell with red unread badge (line 74) is fine. **The dropdown panel is the problem.**
- **P0-A — panel clipped off the left edge of the screen.** Measured: the first notification title's left edge is at **x = −43px** (390px viewport). The panel is `absolute right-0 … w-[380px] max-w-[calc(100vw-1rem)]` (line 82) anchored to the bell, which sits near the right edge of the toolbar; the 380px panel (capped to ~374px by `max-w`) extends past the left edge, so the leading ~1–2 characters of every row are cut ("…bmission awaiting review", "…m Entrance stopped reporting"). **Reproduces at 360 too.** Fix: on mobile, anchor the panel to the **viewport** not the bell — e.g. a `fixed left-2 right-2` (or a bottom sheet) below `md`, instead of `absolute right-0`. This is the admin's primary triage surface; half-unreadable is a real failure.
- **Data-shape bug (P2, functional):** the component reads `n.isRead` (lines 102/109/117/120) and `n.kind` (line 106 → `kindIcon`), but the unread badge/count comes from `data.unreadCount`. If the API actually returns `read`/`type` (as several call sites and my mock assumed), the per-row read styling + icon silently fall back to the default. Worth confirming the API contract — a wrong field name means every row renders as "read"/generic-icon regardless of true state. (Couldn't confirm the live API field name here; flagging for the team to verify against the NestJS DTO.)
- **a11y (P2):** outside-click close binds `mousedown` only (line 52) — fine on touch (synthesized), but there's no ESC-to-close and the panel isn't a focus-trapped dialog.

### 7. Reviews — `apps/web/src/app/[schoolId]/reviews/page.tsx`
**Screens:** `…-08-reviews.png`
Has had a genuine mobile pass: below md it's a **single-pane push** (list full-width → tap row → detail slides in with its own Back), `h-[calc(100dvh-137px)]` (dvh, subtracts both toolbar + tab bar, line 59), detail pane `pb-[calc(72px+safe-area)]` so the sticky Approve/Reject bar clears the tab bar (line 113), filter chips + Approve/Reject all `min-h-[44px]`. `scrollWidth 360 == clientWidth 360`. No overflow. This is the model the rest of the app should follow.

### 8. Emergency trigger modal (from drawer) — `apps/web/src/components/emergency/EmergencyTriggerModal.tsx`
**Screens:** `…-06-emergency-modal.png`, `…-06b-emergency-modal-confirm.png`
Opened from the drawer's red **Emergency** button (`Sidebar.tsx:600` → `EmergencyTriggerModal`). On mobile it's a **bottom-anchored sheet** (`items-end md:items-center`, line 154), `max-h-[90dvh]` with internal scroll, `z-[100]` above the tab bar, and `useOverlayLock()` (line 37) hides the tab bar — all correct. 2-col type grid (measured 6 type buttons), select → Step 2 typed-confirm ("TYPE LOCKDOWN TO CONFIRM"), Cancel + "Trigger Emergency" footer. Failure path shows a red "dispatch FAILED — alert was NOT sent" banner + Retry (lines 235-256). Strong.
- **P1 — on first paint the top of the type grid (Hold / Secure) is partly scrolled under the sticky red header.** The sheet opens scrolled such that row 1 of the 6 SRP types is clipped behind the header; the operator must scroll up to see/scroll to find Hold & Secure. For a life-safety picker, all 6 types should be visible (or the sheet should open scrolled to top). Verify header is `sticky` + the scroll container starts at type 1.
- **Design inconsistency (P1):** this modal exposes **6 SRP types**, matching `/panic`. Good — but the *invocation* differs by surface: drawer/desktop = **typed-confirm**, `/panic` = **3-second hold**. Two different confirm gestures for the same action. Acceptable (different contexts) but worth a deliberate decision; document it.

### 9–12. Panic page — `apps/web/src/app/panic/page.tsx` (the crown jewel)
**Screens:** `…-09-panic-idle.png`, `…-10-panic-holding.png`, `…-10b-panic-released-early.png`, `…-11-panic-triggered.png`, `…-13-panic-unauthorized.png`
This is excellent and I want to be specific about *why*, because it's the bar the rest of the app should hit:
- **Idle:** 6 color-coded SRP circles (Hold/Secure/Lockdown/Evacuate/Shelter/Medical) in a 2×3 grid. Measured **159×159px each @390, 144×144px @360** — vastly above the 44px min; trivially one-thumb. `scrollWidth==clientWidth`, `bodyHeight==clientHeight` (844/800) — the whole grid fits with **zero scroll** at both sizes. Header shows the operator email + "Press and hold any button for 3 seconds to broadcast."
- **Hold gesture — verified by touch.** Pressing a circle for 1.3s shows the animated SVG progress ring sweeping around it and the label flips to "Hold…" (measured `holdProgressRing = 2` circles present; visual confirms the arc). `setPointerCapture` (line 232) pins the gesture so finger-drift within the 159px target doesn't cancel — a real life-safety detail. Releasing before 3s **cancels** (verified — `10b` returns to idle, no fire). Holding the full 3s **fires** (verified — transitioned out of idle).
- **Triggered / failure:** because `broadcastEmergency` is a server action that can't be route-mocked, the live hold hit the real (unreachable-in-test) API and rendered the **failure** state — which is itself the most important surface to get right, and it's *perfect*: huge red "FAILED", "Your alert was NOT broadcast.", "NOTIFY SECURITY MANUALLY for the actual incident", the technical reason, and full-width "TRY AGAIN" / "RE-LOGIN". (In a real deploy with a reachable API this is the "Broadcasted" success screen instead — `page.tsx:405-444`.)
- **Unauthorized (CONTRIBUTOR):** amber shield-off, "NO TRIGGER AUTHORITY", "NOTIFY SECURITY MANUALLY… Ask a district or school admin to grant trigger authority", Switch Account button. The RBAC gate (`hasPanicAuthority`, line 20) renders this *before* the grid so a non-authorized user never sees a trigger they can't use, then gets a 403 mid-lockdown.
- **a11y:** `role="status" aria-live="assertive"` live region present (measured `panicLiveRegion = 1`) + best-effort Web Speech; keyboard Space/Enter hold path mirrors touch (lines 246-257). Strong.
- **Minor (P2):** the `/panic` route is full-screen black with **no obvious "back to dashboard" affordance** in idle. Intentional (immersive safety surface) but a small "Exit" for the case where someone opened it by accident would help. Low priority.

### 13. Dashboard during ACTIVE emergency — `apps/web/src/components/layout/EmergencyOverlay.tsx`
**Screens:** `…-14-dashboard-emergency-active.png`
Full-screen red takeover: big alert icon, "EMERGENCY ACTIVE", "All screens are currently locked…", **type-CLEAR** all-clear gate + "Terminate Emergency (All Clear)" button (full-width). `role="alertdialog"` + nested `role="alert" aria-live="assertive"` + focus-on-mount + focus-trap (lines 79-108) — excellent a11y. Reduced-motion respected.
- **P0-C (ranked P0 per "emergency friction = auto-P0") — the bottom tab bar renders ON TOP of the emergency overlay and is tappable.** `EmergencyOverlay` is `absolute inset-0 z-50` *inside* the dashboard's relative container (`DashboardLayout.tsx:165`), while `MobileTabBar` is a sibling `fixed z-[60]` (`MobileTabBar.tsx:222`). So z-60 > z-50 → the tab bar sits above the red lock, and the "Terminate Emergency" button is crowded against it. Two issues: (a) a user can tap Assets/Playlists/etc. and leave the all-clear screen (the overlay re-mounts on the next dashboard page, so they don't *escape* it app-wide, but they can navigate away from the clear action — friction during an incident), and (b) it looks broken. **Fix:** make `MobileTabBar.isHidden` also true when `isEmergencyActive`, **and/or** have `EmergencyOverlay` call `useOverlayLock()` (it currently does not) so the existing `overlayOpenCount` gate hides the tab bar — the cleanest one-line fix. Also consider raising the overlay to `z-[100]` and making it `fixed inset-0` so it covers the full viewport like the trigger modal does.
- **P2:** `EmergencyOverlay` uses `inset-0` / `inset-x-0` (lines 92/115/116). This is a *dashboard* component (not player/widget), so it's outside the Chromium-83 `inset` rule's scope — but if this overlay is ever reused on the player route, it would collapse on Taurus. Note for the future.

### 14. Top toolbar — `apps/web/src/components/layout/TopToolbar.tsx`
**Screens:** visible in `…-04`, `…-07`
Hamburger (left), then SchoolSwitcher + NotificationsBell + HelpDrawer + avatar menu (right). Dense at 360 but legible; avatar dropdown is `max-w-[calc(100vw-1rem)]` (good). The bell is the weak point (see #6).
- **Dead code (P2, not user-visible):** `TopToolbar` still declares `isModalOpen`/`setIsModalOpen` and renders `<EmergencyTriggerModal>` on it (lines 26, 140) but **nothing ever calls `setIsModalOpen(true)`** — the comment (line 71) says the emergency button moved to the Sidebar. So this is dead state + a never-shown modal mount. Harmless but should be removed; it's a trap for the next editor who thinks the toolbar opens emergency.

---

## Emergency reachability on mobile (the load-bearing question)

A `SCHOOL_ADMIN` on a phone can reach an emergency trigger **three** ways:
1. **Bottom tab bar → "Alerts"** → `/panic` (hold-to-trigger). Always visible. ✅ Primary, excellent.
2. **MobileDashboard → red "Emergency triggers" hero** → `/panic`. ✅ Prominent on home.
3. **Hamburger → drawer → red "Emergency" button** → typed-confirm modal. ✅ But 32px target (P1) and behind a redundant drawer.

So reachability is **strong** (the brief's core worry — "is emergency reachable one-thumb?" — is a clear yes). The friction is *consistency*: two different confirm gestures (hold vs typed) and three entry points. Path #1 (tab → /panic → hold) is the gold standard; I'd make it *the* path and demote the drawer button to a link into `/panic` so there's one trigger UX, not two.

---

## Ranked fix list

### P0 (ship-blockers / emergency friction)
- **P0-A · Notification panel clipped −43px off-screen left** (`NotificationsBell.tsx:82`). First word of every notification unreadable, both viewports. Anchor to viewport (`fixed left-2 right-2` or bottom sheet) below `md`. *Measured.*
- **P0-B · Active drawer nav label invisible** — indigo text on indigo bg, 0 contrast (`Sidebar.tsx:548,551`). Replace the broken `color-mix` arbitrary bg with a real low-opacity tint and force readable label color. Both viewports. *Measured.*
- **P0-C · Tab bar tappable over the active-emergency all-clear overlay** (`MobileTabBar.tsx:71-86` missing `isEmergencyActive`; `EmergencyOverlay` lacks `useOverlayLock()`; z-50 < z-60). Ranked P0 under the brief's "emergency friction = auto-P0." One-line fix: add `useOverlayLock()` to `EmergencyOverlay`.

### P1 (rough but not blocking)
- **P1-1 · Emergency trigger modal opens with the top SRP type row (Hold/Secure) scrolled under the header** (`EmergencyTriggerModal.tsx:154-204`). All 6 life-safety types should be visible without hunting.
- **P1-2 · Three overlapping nav systems on mobile** (tab bar + More sheet + full drawer, with duplicate items). Drop or repurpose the hamburger drawer on phones.
- **P1-3 · Drawer Sign-out is 28×28px** (`Sidebar.tsx:645`) and **drawer Emergency button is 32px tall** (`Sidebar.tsx:598`) — both below the 44px touch minimum; Emergency is life-safety.
- **P1-4 · Two different emergency confirm gestures** (hold on `/panic` vs typed-confirm in the modal). Pick one as canonical; route the drawer button into `/panic`.

### P2 (polish / correctness)
- **P2-1 · Notifications read-state field mismatch** — component reads `n.isRead`/`n.kind` (`NotificationsBell.tsx:102,106`); confirm the API DTO field names or every row renders as read/generic.
- **P2-2 · Dead `isModalOpen` + unreachable `EmergencyTriggerModal` mount in TopToolbar** (`TopToolbar.tsx:26,140`). Remove.
- **P2-3 · Login "Sign in" button reads disabled** (light lavender) — use solid brand color.
- **P2-4 · Mobile dashboard drops the inline pending-asset Approve** affordance the desktop has; add inline/swipe approve to close the loop on a phone.
- **P2-5 · `/panic` idle has no exit affordance** (intentional immersive surface; add a small Exit for accidental opens).
- **P2-6 · `EmergencyOverlay` uses `inset-0`/`inset-x-0`** — fine for dashboard, but a Taurus/Chromium-83 landmine if ever reused on the player route.

---

## What's genuinely excellent (keep / copy this)
- **`/panic` is best-in-class** — 144–159px hold targets, working touch progress ring, finger-drift capture, aria-live + speech, immaculate failure copy, RBAC gate before the grid. This is the design bar for the whole app.
- **`MobileDashboard`** is a real mobile-first surface that leads with emergency — the competitive differentiator delivered, not just claimed.
- **`MobileTabBar`** — correct tap targets, danger-red Alerts, safe-area padding, and it correctly self-hides for drawer/overlay/panic/player.
- **`/reviews`** — the single-pane push + dvh + tab-bar-clearance pattern is exactly right; make it the template for other list/detail pages.
- **Zero horizontal overflow** on every audited surface at both 390 and 360.

---

## Method notes / caveats
- Server action `broadcastEmergency` (`apps/web/src/actions/trigger-emergency.ts`) runs server-side, so its `fetch` to the API can't be Playwright-route-mocked; the live full-hold therefore exercised the **failure** UI (which passed). Success-state ("Broadcasted") was verified by source read (`panic/page.tsx:405-444`) only — recommend a real end-to-end hold test against a live API before launch to confirm the success transition + all-clear poll.
- Notification icon/read-state field names (`kind`/`isRead`) could not be confirmed against the live NestJS DTO in this read-only mock harness — flagged P2-1 for the team to verify.
- Tested on Chromium only (per brief). WebKit/Safari-iOS not exercised here; the `dvh`/`env(safe-area-inset-*)` usage is iOS-aware in the code, but a real iOS-Safari pass is still owed (CLAUDE.md cross-browser rule).
