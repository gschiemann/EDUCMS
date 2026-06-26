# Wave F — Mobile / iPhone UX + perf (§17, §18, §20)

**Agent:** F2 — Mobile / iPhone UX + perf confirmation pass
**Date:** 2026-06-26
**Surface:** Authenticated dashboard on a ~390px iPhone viewport (the operator's daily driver), plus the live geocode endpoint.
**Scale tier:** Read-only code audit + live-prod curl. No `pnpm dev`/build/Playwright per ground rules.
**Standard Audit Surface §§ covered:**
- **§17 Operational + DX** — mobile-perf CI guard wired + green; covered.
- **§18 Accessibility** — touched lightly (aria on nav/menus); deferred deep a11y to a dedicated agent.
- **§20 Design / UX / Functionality lenses** — graded below.
- Mobile-perf classes from CLAUDE.md "Mobile performance standard" — all three checked.

This is the **final pre-launch confirmation pass**, not a fresh full audit. Prior FULL mobile audits: #186, #203, #204 (the 10-P0 punch-list), #193, and the 2026-06-09 (`16-mobile-ux.md`) + 2026-06-25 live-test (`wave3-mobile-raw.json`) passes. My job: re-verify the high-severity classes are still closed and surface anything new.

---

## Step-by-step what I did

1. **Read the perf guard** (`apps/web/tools/check-mobile-perf.cjs`) to learn its three violation classes (A: bg-poll, B: global focus-refetch, C: mobile-active blur on persistent chrome), then **ran it** — `OK — mobile-perf guard clean (4 chrome files + bg-poll + focus-default)`, exit 0.
2. **Confirmed the CI workflow** (`.github/workflows/mobile-perf.yml`) runs `node apps/web/tools/check-mobile-perf.cjs` on every push + PR to master, <1 min. Checked run history via `gh run list` — **green** on the latest master commits (2026-06-26).
3. **Manually re-ran each perf-guard class** with grep:
   - A: `grep -rnE "refetchIntervalInBackground\s*:\s*true" apps/web/src` → one hit, `LeadersPanel.tsx:80`, carrying a `// perf-allow:` comment (the legitimate live-board exception). Clean.
   - B: `providers.tsx:26` → `refetchOnWindowFocus: false` (the global default stays OFF). Clean.
   - C: grepped `backdrop-blur`/`blur-[` in all 4 chrome files — every hit is breakpoint-gated or removed (details below). Clean.
4. **Walked the three known MOBILE BUG P0s (#215/#216/#217)** by reading current code (these map to the prompt's MOBILE BUG 1/2/3):
   - #215 media-picker toolbar-over-top-nav → `AssetPicker.tsx`.
   - #216 address picker → `ScreenLocationModal.tsx` + `/api/v1/geocode` + `AddressAutocomplete.tsx`.
   - #217 screen-settings drawer push-off-left → `ScreenSettingsMenu` in `screens/page.tsx`.
5. **Live-prod verification:** signed up a throwaway SPORTS tenant (`/api/v1/csrf` → `/api/v1/signup` with CSRF double-submit + Bearer token), then hit `/api/v1/geocode` with 4 real US street addresses.
6. **Scanned key mobile pages for new 390px clipping** — oversized fixed widths, missing `sm:`/`md:` gates, horizontal overflow — on screens/assets/playlists/templates/TopToolbar + the sports console.
7. **Cross-checked the 2026-06-25 live-test** (`wave3-mobile-raw.json`) for still-open P1s and verified each against current code + git log.

---

## Findings table

| # | Sev | Area | What | Repro | Evidence (file:line / curl) |
|---|-----|------|------|-------|------------------------------|
| F2-1 | **P2** | Bug-reporter FAB | Floating "Report bug" FAB (`z-[70]`, fixed `right-4 bottom-24`) visually overlaps card content mid-scroll on mobile (e.g. the Templates card PREVIEW pill), worse on WebKit. No collision-avoidance / auto-nudge. Cosmetic only on the PREVIEW pill (it's `pointer-events-none`, so taps fall through to the FAB), but it reads as "broken" and can sit over *interactive* card actions on other cards. | On iPhone WebKit, scroll the Templates gallery so a card passes under the bottom-right FAB. | `BugReporterButton.tsx:131` (`fixed right-4 bottom-24 md:bottom-6 ... z-[70]`); no `nudge/collision/IntersectionObserver` (grep empty); pill at `templates/page.tsx:1988` (`absolute top-3 right-3 ... pointer-events-none`). Flagged in `wave3-mobile-raw.json` (2026-06-25) as P1; FAB last touched `a29a22e4` 2026-05-29 (no fix since). |
| F2-2 | **P2** | Assets filter chips | Horizontal filter-chip scroller has no right-padding, so the last chip ("Documents") kisses the screen edge on a phone (no trailing breathing room). Cosmetic. | iPhone, Assets page, scroll the type-filter chip row to the end. | Carried over from `wave3-mobile-raw.json` (2026-06-25). Not re-deep-verified in this pass — flagged as a known low-sev polish item, not independently reproduced. |

**No P0 or P1 found in this pass.** Both items above are cosmetic polish (P2). Everything load-bearing is closed.

---

## Re-verification of the known high-severity classes (all CLOSED)

### Mobile-perf standard — CLEAN + CI-locked (§17)
- **Guard runs green** (`OK — mobile-perf guard clean`). CI workflow `Mobile Perf` fires on every push + PR to master and was **success** on the latest master HEAD (2026-06-26, `gh run list`).
- **Class A (bg-poll):** only `LeadersPanel.tsx:80` with `// perf-allow:` (live-game board — the documented legit exception). No other background pollers.
- **Class B (focus storm):** `providers.tsx:26` global default `refetchOnWindowFocus: false`. No global `true`.
- **Class C (chrome blur):** all breakpoint-gated —
  - `DashboardLayout.tsx:140,146` decorative blobs are `hidden md:block` (desktop-only).
  - `MobileTabBar.tsx:232` dropped `backdrop-blur-md` entirely (solid `bg-white`).
  - `TopToolbar.tsx:58` `backdrop-blur-none md:backdrop-blur-xl` (mobile gets none).
  - `Sidebar.tsx:313` drawer backdrop dropped `backdrop-blur-sm`.

### MOBILE BUG #215 (media picker toolbar over top nav) — FIXED
`AssetPicker.tsx:179` is a **centered modal** (`fixed inset-0 z-[10001] flex items-center justify-center p-4`) with `max-w-2xl max-h-[82vh]` and an **internal** header + toolbar (`AssetPicker.tsx:186,199`). It calls `useOverlayLock()` (`:65`), which bumps `overlayOpenCount` so `MobileTabBar` hides itself (`MobileTabBar.tsx:88`). The toolbar is contained in the modal's own scroll region — it structurally cannot float over the app's top nav. **Closed.**

### MOBILE BUG #216 (address picker not finding real US streets) — FIXED (and better than "partial")
Prior audit (`16-mobile-ux.md`) called this "PARTIALLY FIXED" because the root cause was a missing `GOOGLE_MAPS_API_KEY` in prod → OSM-only street-level results. **The Google key is now live in prod.** Live test (authed Bearer):
- `1600 Pennsylvania Avenue NW Washington DC` → `"1600 Pennsylvania Ave NW, ... 20500"`, `"source":"google"`, `"provider":"google"`.
- `350 Fifth Ave New York NY 10118` → `"350 5th Ave, New York, NY 10118"`, google.
- `1 Infinite Loop Cupertino CA` → exact, google.
- `123 Main St Anytown OH` → house-number-precise google candidates.
The server-side proxy (`ScreenLocationModal.tsx:169` `geocodeViaApi`) returns Google house-number precision; OSM Photon/Nominatim remain as fallback. **Closed.** (curl evidence above.)

### MOBILE BUG #217 (screen-settings drawer pushes off left edge) — FIXED
`ScreenSettingsMenu` (`screens/page.tsx:842`) is a viewport-anchored portalled popover (`fixed w-64`, `:1042`). `updateAnchor()` (`:879`) clamps so the panel is **always fully on-screen**: the desktop branch (`:901-905`) clamps left edge ≥ MARGIN; the **phone branch** `if (vw < 500)` (`:894-899`, added 2026-06-26) center-anchors it so it can't run off the left edge regardless of where the gear sits in the action row. `maxHeight` is capped to available space (`:914-922`) so it never drops off the bottom. **Closed.**

---

## Mobile chrome + key workflows — read-verified GOOD

- **Bottom-nav + More sheet** (`MobileTabBar.tsx`): solid `bg-white` (no blur), `pb-[env(safe-area-inset-bottom)]`, hides on overlay-open. The "More" sheet uses `willChange: transform` + `contain: paint` (`:189`) for a GPU-promoted slide. Home tab points to `${base}/dashboard` (the old 404 fix). Solid.
- **TopToolbar** (`TopToolbar.tsx`): hamburger `md:hidden`; emergency button `md:hidden` with `hidden sm:inline` label (icon-only at the narrowest); user dropdown uses `max-w-[calc(100vw-1rem)]` so it never overflows. Solid.
- **Sports console** (`sports/[gameId]/page.tsx`): purpose-built mobile-first — `md:contents` dissolves the desktop wrapper (`:1394`), dedicated `md:hidden` `MobileScoreMirror` (`:1933`) + `MobileScoreDock` thumb-zone (`:2004`), deck scrolls as one column. `min-w-[*]` values live inside horizontal-scroll/flex containers or desktop-gated tiles. Solid.
- **Sports "Game Day" landing** (`sports/page.tsx:95`): header now `flex flex-col gap-3 sm:flex-row` — **stacks on mobile** (fix `ca687d16`, 2026-06-25 13:11, directly closing the live-test P1). Solid.
- **Address modal** (`ScreenLocationModal.tsx:305`): `max-w-lg w-full p-4` centered + `useOverlayLock` + result dropdown `max-h-64 overflow-y-auto`. `AddressAutocomplete.tsx:282` dropdown is `absolute left-0 right-0` (full-width, never clips). Solid.
- **No oversized fixed widths** on screens/assets/playlists/templates that bite at 390px. The one `w-[720px]` hit (`playlists/page.tsx:2606`) is `lg:w-[720px]` (desktop-only) over a `grid grid-cols-2` mobile layout — false positive.

---

## Coverage — what I could NOT reach + why

- **Live rendered pixels on a real iPhone / WebKit:** ground rules barred Playwright/browser-drive; I read the live geocode API and the responsive Tailwind source, but did not screenshot the 390px render. The two P2 cosmetic items (FAB overlap, chip padding) are inferred from source + the 2026-06-25 live-test, not re-photographed this pass.
- **Deep a11y (§18):** spot-checked aria on nav/menus/dialogs; a full axe-core/keyboard sweep is a separate agent's scope.
- **F2-2 (chip padding)** carried from the live-test without independent repro this pass — listed for completeness, low confidence on exact current state.

---

## Grade (Greg's 3 lenses)

- **Design: A−.** Mobile chrome is clean, modern, thumb-reachable; sports console is genuinely mobile-first. Only the FAB-over-card cosmetic overlap keeps it off a flat A.
- **UX: A.** All three historical mobile P0s (#215/#216/#217) are closed; the operator can run signup, screen settings, address pick, and the game-day console from a phone without hidden/clipped controls. Geocode now returns Google house-number precision live.
- **Functionality: A.** Perf standard is clean AND CI-locked; live geocode verified working; no functional mobile breakage found.

**Launch verdict for mobile/iPhone UX + perf: GO.** No P0/P1. Two P2 cosmetic-polish items remain (FAB overlap, chip padding) — neither blocks beta.
