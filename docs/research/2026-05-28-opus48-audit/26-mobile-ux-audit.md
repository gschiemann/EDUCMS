# Mobile UX Audit — VenueOS (read-only)

> Opus 4.8, 2026-05-28 (Wave 3). Static analysis + LIVE Playwright reproduction at
> 375×667 (iPhone SE), 390×844 (iPhone 14), 360×800 (Android), fake admin session +
> mocked API. Screenshots captured. Answers the lead's "the windows get hidden."

## Headline
"Windows get hidden" is **100% reproducible** and a real **systemic bug class**: overlay
panels (header dropdowns + several modals) are sized/positioned for desktop and render
**off-screen / clipped** on phones, and the bottom tab bar **occludes** the open drawer's
footer. Page *content* is responsive and fine — the **chrome + modals are the failure surface.**

## Surfaces
| Surface | File | Verdict |
|---|---|---|
| Panic/SOS | `panic/page.tsx`+`panic/layout.tsx` | **Usable/well-built** — zoom lock, hold-to-trigger, safe-area, 160px targets, live region. The one good mobile surface. |
| Dashboard chrome (drawer+tabbar+header) | `layout/DashboardLayout.tsx`,`Sidebar.tsx`,`MobileTabBar.tsx`,`TopToolbar.tsx` | **Broken** — dual-nav occlusion + clipped dropdowns |
| Header dropdowns (notif/school/avatar) | `NotificationsBell.tsx`,`SchoolSwitcher.tsx`,`TopToolbar.tsx` | **Broken** — render off the left edge, clipped |
| Emergency Trigger modal | `emergency/EmergencyTriggerModal.tsx` | **Broken / life-safety** — taller than viewport, header+Trigger button clipped, no scroll |
| Template builder | gated in `DashboardLayout.tsx` | **Fails gracefully** (≥1024px required) — correct |
| Content pages | `app/[schoolId]/*` | **OK** — no h-overflow at 360/375 |
| Reviews master-detail | `reviews/page.tsx` | **Partial** — `h-[calc(100vh-64px)]` over-sizes, sticky approve bar under tabbar |
| Secondary modals (streaming/pos/monetize/etc.) | various | **Mixed** — several lack max-h/scroll |

## ROOT CAUSES of "windows get hidden" (3)
**A — Header dropdowns are desktop-width, `absolute right-0`, overflow the LEFT edge.**
- `NotificationsBell.tsx:82` `w-[380px]` on a 360px screen → measured `left:-73px`, text clipped ("…ions").
- `SchoolSwitcher.tsx:74` `w-[280px]` → `left:-21px` at 360px.
- `TopToolbar.tsx:110` avatar menu `w-56` (224px) → `left:-26px` at 360px (fits at 375 by luck).
No `max-w-[calc(100vw-…)]`, no mobile bottom-sheet fallback. **Fix:** on `<md` render as full-width sheet / `left-2 right-2 w-auto` + cap `max-w-[calc(100vw-1rem)]`.

**B — Modals centered with NO `max-height` clip top+bottom off-screen.**
`EmergencyTriggerModal.tsx:147` outer `fixed inset-0 flex items-center justify-center`; card `:149` `max-w-2xl … overflow-hidden` **no max-h**. At 375×667 card=717px > 667px viewport: `top:-25` (title clipped), footer Cancel+**Trigger Emergency button clipped below screen**, `overflow-hidden` prevents scrolling to it. **The literal "hidden window" on the most safety-critical surface** (reachable on mobile via Sidebar Emergency button). **Fix:** card `max-h-[90dvh]` + outer `items-end md:items-center` (internal scroll already exists).

**C — Drawer (z-40) + MobileTabBar (z-60) both active; tabbar occludes drawer footer.**
Two full nav systems live at once. At 375×667 drawer footer y582–647 vs tabbar y610–667 → **"Sign out" buried under the tabbar**. Also redundant (same items in both). **Fix:** hide tabbar while drawer open (or suppress drawer on phones); pick ONE mobile nav.

## Ranked defects
**P0 (life-safety / blocks task)**
1. **EmergencyTriggerModal clips action buttons off-screen** `:147-149,252-272` — `max-h-[90dvh]` + `items-end md:items-center`. *Screenshot captured.*

**P1 (frequent, breaks nav/notifications)**
2. NotificationsBell dropdown clipped left `:82` — mobile sheet / `max-w-[calc(100vw-1rem)]`.
3. SchoolSwitcher dropdown clipped left `:74`.
4. Avatar/user menu clipped left at 360px `TopToolbar.tsx:110`.
5. Drawer footer + Sign-out occluded by MobileTabBar (`Sidebar.tsx:309` z-40 vs `MobileTabBar.tsx:200` z-60) — hide tabbar while drawer open / drop drawer on phones.

**P2 (degraded on short screens / keyboard up)**
6. Modals missing `max-h`: `settings/streaming/page.tsx:569,1270`, `settings/pos/page.tsx:299`, `settings/monetize/page.tsx:421` (siblings at streaming 777/953/1159 DO have `max-h-[90vh]` — inconsistency). Add `max-h-[85dvh] overflow-y-auto`.
7. Reviews split-pane over-sizes: `reviews/page.tsx:51` `h-[calc(100vh-64px)]` (header is 73px; use `dvh`/container height); sticky approve bar `:261` under tabbar.
8. `100vh`→`100dvh` in shell: `DashboardLayout.tsx:67`, `Sidebar.tsx:309`.

**P3 (polish)**
9. EmergencyTriggerModal uses `fixed inset-0` `:147` — NOT a Taurus risk (dashboard, not player surface); flagged for consistency only.
10. Small tap targets (<44px) on public login/marketing footers.
11. "More" sheet (z-61) under InstallPromptBanner (z-70) edge case.

## Builder-on-mobile: intentionally desktop-only, fails gracefully (CORRECT)
`DashboardLayout.tsx:42-64` shows "Larger screen required ≥1024px" card under `lg:hidden`; builder is `hidden lg:block`. Verified live at 390px — clean gate, no broken panel. No action needed.

## Fix wave by file
- `EmergencyTriggerModal.tsx` — **P0** max-h-[90dvh] + items-end md:items-center
- `NotificationsBell.tsx`,`SchoolSwitcher.tsx`,`TopToolbar.tsx` — **P1** mobile sheet + max-w cap, stop overflowing left
- `Sidebar.tsx`/`MobileTabBar.tsx`/`DashboardLayout.tsx` — **P1** hide tabbar while drawer open / resolve dual-nav + footer occlusion
- `settings/streaming|pos|monetize/page.tsx` — **P2** add max-h-[85dvh] overflow-y-auto
- `reviews/page.tsx` — **P2** container-relative height + dvh
- shell `100vh`→`100dvh`

**Good news:** the correct pattern already exists in-app (`flex items-end md:items-center … max-h-[90dvh]` e.g. `playlists/page.tsx:2209`, `templates/page.tsx:686`) — the fix is PROPAGATING it to the offending dropdowns/modals, not inventing anything.
