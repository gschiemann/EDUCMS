# Mobile-UX Audit — Consolidated Ranked Punch-List
**2026-05-29 · 5-agent fleet, every tab Playwright-screenshotted at 390×844 + 360×800, admin session + mocked API · read-only (config contamination reverted by lead).** Slice reports: 01-screens · 02-playlists-schedules · 03-assets-templates · 04-settings-branding-integrations · 05-dashboard-nav-emergency. Screenshots in `scratch/mobile-ux-audit/` (gitignored).

## Verdict
The mobile foundation is **real and in places excellent** — `/panic`, `MobileDashboard`, `MobileTabBar`, `/reviews`, the Pair modal, the Connect modals (`useOverlayLock` verified working), the detail "Publish to Screens" bottom-sheet, and the builder mobile-guard are all purpose-built mobile-first and should be the **templates to copy**. But **10 P0s** sit on critical paths — most are desktop flex rows / fixed grids / absolutely-positioned panels with **no mobile reflow**, plus a few mis-rendering arbitrary Tailwind classes. Greg's "Screens tab is unusable" is confirmed and is the worst of them. **Almost every P0 fix is "copy the reflow pattern that already exists elsewhere in the same file."**

## P0 — blocks the task / unusable / correctness / emergency (10)
| # | Surface | Bug (measured) | Fix | File:line |
|---|---|---|---|---|
| P0-1 | **Screens list** (Greg's complaint) | rows = **294px tall** (5× desktop), name wraps 3-4 lines, **delete+gear buttons render off the right edge (x=436/484 in 390px)** untappable; 34px (<44) | reflow row to mobile stack; copy the Floor-plans tab pattern (same file) that hides overflow buttons + `grid-cols-1` | `screens/page.tsx:1744` (grouped) `:1953` (ungrouped) |
| P0-2 | **Screens toolbar** | "New Group" clipped **60px off-screen**; Pair/Floor-plans wrap | wrap/stack toolbar on `<sm` | `screens/page.tsx:1503` |
| P0-3 | **Templates gallery** | all 5 hero CTAs (New/Import/Import-json/AI/Apply-brand) **overflow off right edge** — can't create/import a template on a phone | stack/wrap; copy Imports + FolderPicker pattern (already mobile-good) | `templates/page.tsx:622,636` |
| P0-4 | **Playlist create wizard** Step-4 | schedule sub-form **clips end-time + end-date off right edge** (~124-154px sheared) — can't set an end window | port the stacked pattern 200 lines away | `PlaylistCreateWizard.tsx:2222` (time) `:2251` (date) |
| P0-5 | **Playlist "Line" list view** | playlist **name renders at 0px width (invisible)** — over-packed non-wrapping flex row | full-width name + hide metadata `<sm` | `playlists/page.tsx:454` |
| P0-6 | **Playlist wizard** Step-4 | form controls nested **inside a `<button>` → React hydration error every load** (`<button> in <button>`) — correctness, same path as old #140 crash | unnest the control from the button | `PlaylistCreateWizard.tsx:2165` |
| P0-7 | **Branding wizard** | live-preview pane lands **~1,690px (2 screens) below the fold** when editing existing brand — the flagship "repaints as you tweak" moment is invisible on mobile | sticky bottom preview drawer (or preview-first) + mobile sticky Adopt bar `<lg` | `BrandingWizard.tsx:464` |
| P0-8 | **Notifications panel** | clipped **43px off-screen left** (`absolute right-0 w-[380px]`) — first word of every notification cut off; the admin triage surface | viewport-anchor `fixed left-2 right-2` below `md` | `NotificationsBell.tsx:82` |
| P0-9 | **Drawer active nav label** | **invisible** — indigo text on indigo bg (broken `color-mix()` arbitrary class renders solid, not an 8% tint) | fix the tint class (same CLASS as the logo-on-white + Fredoka arbitrary-class bugs) | `Sidebar.tsx:548,551` |
| P0-10 | **Emergency all-clear** (auto-P0) | the bottom tab bar renders **tappable OVER the active-emergency all-clear overlay** — user can navigate away mid-incident (`EmergencyOverlay` z-50 vs MobileTabBar z-60; `isHidden` omits `isEmergencyActive`; overlay never calls `useOverlayLock`) | **one-line: add `useOverlayLock()` to `EmergencyOverlay.tsx`** (+ optionally add `isEmergencyActive` to the tab-bar hide) | `EmergencyOverlay.tsx` |

## P1 — touch ergonomics + duplicated components + dead-ends
- **Screens:** 2 touch-dead controls (ungrouped "Move to group" `<select>` is `opacity-0 group-hover` `:1994`, invisible on touch; status = clipped pills + emoji-only `🛡️`/`Cr83` jargon `:1819-1839`); map `h-[600px]` `ScreenMap.tsx:145` = 73% of viewport, 24px pins overlap (no clustering), legend below fold.
- **Assets:** tap targets 34px/26px (`:593,606,738`); per-tile select/delete `group-hover`-gated → never appear on touch (`:957,967`); create/AI/import paths dead-end at the desktop builder wall → should land back on the gallery with a handoff.
- **Playlists:** schedule editor exists **twice** with divergent quality — extract one shared `<ScheduleWindowFields>` + iOS-hardened `TouchSensor delay:150` (the wizard reorder is `PointerSensor`-only `:1538`; the detail editor has the iOS fix `page.tsx:1054-1073`); sub-44px day buttons (29px), drag handle (20×20), duration inputs (48×26).
- **Settings:** `BrandingLivePreview` is a fixed `grid-cols-[180px_1fr]` desktop mock w/ no breakpoints (`:108`) → unreadable at 360px; wrap in the house `transform:scale()` pattern.
- **Dashboard/Emergency:** trigger modal opens with the top SRP type row scrolled under its header; **three overlapping nav systems** (tab bar + More sheet + redundant hamburger drawer w/ duplicate items); drawer Sign-out 28px + Emergency button 32px (<44); two different emergency confirm gestures (hold on `/panic` vs typed-confirm in the modal) — unify.

## P2 — polish
- **Cross-cutting:** the bug-reporter FAB ("1 Issue" chip) is **not `useOverlayLock`-aware** → floats over modal/sheet footers on every bottom-anchored surface (flagged by Assets + Settings + Dashboard agents). Wire it to `overlayOpenCount` like the tab bar.
- Static `vh` not `dvh` in `WhyClosedModal`/`ChannelPickerModal` (can exceed mobile-Safari viewport).
- Folder names truncate w/ no touch-accessible tooltip; "Emergency alerts" settings row truncates at 360; "Invite by email" button label disagrees with the default "Set password" mode.
- Verify `Notification` `isRead`/`kind` field names against the API DTO; remove dead `isModalOpen` + unreachable `EmergencyTriggerModal` in `TopToolbar.tsx`.

## Good patterns to COPY (don't regress these)
Pair modal (358px, big code field, working QR) · Floor-plans tab (`grid-cols-1` + hides Pair/New-Group) · Connect modals + `useOverlayLock` (all 6 streaming + POS + USB) · detail "Publish to Screens" bottom-sheet (stacked dates, sticky `flex-1` footer, safe-area, `90dvh`, iOS TouchSensor) · `MobileDashboard` / `MobileTabBar` / `/reviews` (single-pane-push + `dvh` + tab-bar clearance) · `/panic` (159px hold-circles, verified 3s hold) · builder mobile-guard (clean "needs ≥1024px" notice).

## Separate (NOT mobile-UX) findings — log as tickets
1. **Turbopack-dev Fredoka font codegen bug** — `font-[family-name:var(--font-fredoka)]` → corrupted generated rule at `globals.css:4614` → **500s authed routes under `next dev`/turbopack** (3 of 5 agents hit it; worked around with `next dev --webpack`). Same CLASS as the 2026-05-09 Safari mangling + the P0-9 `color-mix` bug (arbitrary-class codegen). **Prod is safe** — `next build` passed 53/53 + venue-os.app serves 200 — so it's dev/turbopack-specific. Verify on pristine master + fix so local `next dev` works without `--webpack`.
2. **`broadcastEmergency` success transition only source-read** — it's a server action whose fetch bypasses Playwright mocking, so the audit verified the (correct) FAILURE path live but not the "Broadcasted" success path. Needs a real end-to-end test against a live API before launch.

## Recommended fix order
1. **P0-10** (emergency all-clear overlay — one line, life-safety) + **P0-1/P0-2** (Screens, Greg's complaint).
2. **P0-3/P0-4/P0-5/P0-6** (create paths: templates + playlist wizard — incl. the hydration error).
3. **P0-7/P0-8/P0-9** (branding preview, notifications, drawer label).
4. P1 ergonomics sweep (extract shared schedule fields, 44px targets, overlay-lock the FAB).
5. The 2 separate tickets (Turbopack font, emergency E2E).
Most P0s are small/mechanical (reflow + copy-existing-pattern); verify each with a phone-width screenshot before claiming done.
