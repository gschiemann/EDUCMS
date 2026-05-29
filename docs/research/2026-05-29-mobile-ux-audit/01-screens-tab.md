# Mobile UX Audit — Screens Tab (and everything reachable from it)

**Date:** 2026-05-29
**Auditor slice:** the Screens tab on a phone — `/[schoolId]/screens` list, screen
cards, status pills, screen-GROUP cards, Pair-a-screen flow, per-screen drill-in
(gear/settings popover), the fleet **Map** view, and the **Floor plans** view.
**Method:** Playwright (Chromium, iOS Safari UA) at **390×844** and **360×800**, mobile
emulation (`isMobile`, `hasTouch`, DPR 2). Admin session injected to `sessionStorage`;
all `/api/v1/*` calls mocked (Origin echoed into `Access-Control-Allow-Origin`,
`credentials: true`) with 8 screens across 2 groups + ungrouped, mixed
ONLINE/OFFLINE/EMERGENCY/PENDING statuses.
**Verdict:** Greg is right. **The Screens list is UNUSABLE on a phone.** Per-screen rows
are a desktop-only flex row jammed into a phone column: each row is **294 px tall**,
the name wraps **3–4 lines**, and **2 of the 3 per-screen action buttons (delete +
settings/gear) render OFF the right edge of a non-scrolling row** — the operator
literally cannot tap them. The top toolbar overflows too: the **"New Group" button is
clipped off-screen**. Map + Floor plans + Pair modal fare much better.

> Repro: `scratch/mobile-ux-audit/audit.cjs` (gitignored). Screenshots:
> `scratch/mobile-ux-audit/screens-{390,360}-*.png`.

---

## Environment note (NOT a Screens bug, but it blocks all mobile testing)

The dev server's **default Turbopack build corrupts `globals.css`** — the source class
`font-[family-name:var(--font-fredoka)]` (valid Tailwind v4 arbitrary value, used in
`apps/web/src/app/layout.tsx` via `--font-fredoka`, and across `help/`, `marketing/`
components) is mangled into garbage bytes in the generated CSS:

```
./apps/web/src/app/globals.css:4629:37
> 4629 |   font-family: family-██████var(-- f█Pka);
Unexpected token Delim('\u{18}')
```

This throws a **fatal compile error on `layout.tsx` → every authed route returns HTTP
500** under Turbopack (`next dev`, the Next 16 default). I had to fall back to
`next dev --webpack` to get the app to render at all. This is the same *class* of bug as
the 2026-05-09 Safari "literal `\n` in a regex" regression already in
`reference_recurring_failure_patterns.md` — a toolchain mangling a string into bytes the
parser rejects. **This is a P0 launch blocker on its own** (it 500s every tenant route in
the default dev/build path), and it should be fixed regardless of this audit. Flagged
separately so it isn't lost.

---

## Page-1 coverage — Design / UX / Functionality (Standard Audit Surface §20)

Grades A–F per lens. Anything ≤ B is a gap. "UNUSABLE" = blocks the core task one-thumb.

| # | Surface | D | UX | F | One-line problem |
|---|---|---|---|---|---|
| 1 | **Top toolbar** (List/Map/Floor + Pair + New Group) | C | **D** | **D** | 434 px control row in a 390 px viewport → **"New Group" clipped off-screen**, "Pair Screen" + "Floor plans" wrap to 2 lines |
| 2 | **Fleet summary strip** (Total/Online/Offline/Emergency) | B | B | A | Wraps to a 2×2 grid; readable. Fine. Only nit: KPI tiles aren't tappable filters |
| 3 | **"How to Connect a Screen" banner** | B | C | C | Eats a full screen-height above the actual fleet; "Copy URL" label clips at 360; pushes real content below 2 folds |
| 4 | **Group card header** (name + Pair + delete) | B | B | A | Holds together; "+ Pair" + trash fit. Fine |
| 5 | **Screen ROW (in group)** | **F** | **F** | **F** | **UNUSABLE.** 294 px tall, name wraps 3–4 lines, delete+gear buttons OFF the right edge of a non-scrolling row |
| 6 | **Status pills** (ONLINE / cache / ping / Cr83) | C | **D** | **D** | 4–6 pills + emoji + relative-time on one cramped line that clips; "🛡️ ready" / "Cr120" jargon, no labels |
| 7 | **Ungrouped Screens block** | C | **D** | **D** | Same broken row as #5, PLUS the "Move to group" `<select>` is `opacity-0 group-hover` → **invisible & unreachable on touch** |
| 8 | **Per-screen gear popover** (drill-in) | B | C | B | Once open it's well-built (256 px, scrolls, viewport-anchored). But the **gear button that opens it is one of the clipped off-screen buttons** (#5) |
| 9 | **Pair-a-screen modal** | A | A | A | **Genuinely good on mobile.** 358 px wide, fits height, big code field, QR expand works |
| 10 | **Pair QR ("scan with phone")** | A | A | B | QR renders 220 px, legible. Minor: a phone operator scanning their own phone's QR is awkward, but harmless |
| 11 | **Map view** (`ScreenMapClient`/`ScreenMap`) | C | **D** | C | Map is **598 px tall (~71–75 % of viewport)**; 6-item legend wraps to **full viewport height** below the fold; bottom occluded by tab bar + bug FAB |
| 12 | **Map pins / clustering** | C | **D** | C | Pins **24×24 px** (≪ 44 px min), **overlap with no clustering** → can't reliably tap the right one one-thumb |
| 13 | **Map popup** (pin detail) | B | C | B | `min-width:180px` popup fits, but it's a dead-end — no "open player / trigger here / drill in" actions the desktop drill-panel promises |
| 14 | **Floor plans tab** | B | B | A | **Fine on mobile** — `grid-cols-1`, toolbar fits (Pair/New Group hidden in this mode). Drilling into a plan editor is desktop-only by design |
| 15 | **Empty / loading states** | B | C | B | Map loading skeleton is a **600 px slab** on a phone; isLoading spinner is `py-20` — both waste the small viewport |
| 16 | **Inline rename** (tap name → edit) | B | C | C | Tap target is the wrapped 3–4-line name; the Save/Cancel buttons land mid-row where the layout is already broken |

**Net:** Map / Floor plans / Pair are B-or-better. **The list itself (rows + toolbar +
pills + ungrouped) is D/F across the board — this is the "unusable" Greg felt.**

---

## Exactly WHY the list is unusable — measured, not guessed

All figures from live DOM measurement at **390 px** (matches the screenshots; 360 px is
strictly worse).

### A. The per-screen row is a desktop flex row with no mobile reflow

`apps/web/src/app/[schoolId]/screens/page.tsx:1744` (group rows) and **:1953**
(ungrouped) both use:

```jsx
<div className="px-4 py-3 flex items-center gap-3.5 group/item ...">
  <div className="w-2.5 h-2.5 rounded-full ..." />     {/* status dot */}
  <div className="w-8 h-8 ...">OsIcon</div>             {/* OS icon */}
  <div className="flex-1 min-w-0"> name + metadata </div>
  <span> STATUS pill </span>                            {/* :1819 */}
  <span> 🛡️ cache pill </span>                          {/* :1828 */}
  <span> Clock + "30s ago" </span>                      {/* :1839 */}
  <button className="p-2 ..."> MapPin </button>          {/* :1855 */}
  <button className="p-2 ..."> Trash2 </button>          {/* :1870 */}
  <ScreenSettingsMenu />  (gear)                         {/* :1882 */}
</div>
```

There is **no `flex-wrap`, no `sm:`/`md:` breakpoint, no mobile card variant.** On a
phone the `flex-1 min-w-0` name column collapses, the trailing pills + 3 icon buttons get
pushed past the viewport, and because the row's parent (`div.p-2.space-y-1`) doesn't grant
horizontal scroll, the buttons are simply **clipped and unreachable**.

Measured at 390 px:
- **Row height: `294px`** (≈ 5× the ~56 px desktop row). 8 screens ⇒ ~2,350 px of scroll.
- Screen name "Main Lobby Welcome Display" wraps to **3 lines @390 / 4 lines @360**.
- Action-button right edges: **`[388, 436, 484]`** — viewport is 390, so the **delete
  (436) and gear (484) buttons sit 46 px and 94 px OFF-screen.** `actionBtnClipped: 2`.
- Action buttons are **`34×34 px`** (need ≥ 44×44; WCAG 2.5.5 / Apple HIG / Material).

> Screenshots: `screens-390-02-group-rows.png`, `screens-360-02-group-rows.png` — the
> green location pin / trash / gear are visually gone; the row is a tower of wrapped text.

### B. The top toolbar overflows — "New Group" is off-screen

`page.tsx:1503` `<div className="flex gap-2 items-center">` holds the 3-segment view
toggle **plus** "Pair Screen" (:1548) **plus** "New Group" (:1555), all at desktop sizes,
with no wrap/stack.

Measured at 390 px: toolbar row **width `434px` (clipped: true)**; **"New Group" button
spans left 353 → right 450 → 60 px of it is off the right edge** (only the `+` icon
shows). "Pair Screen" and "Floor plans" wrap to 2 lines. At 360 px it's worse.

> Screenshots: `screens-390-01-list-top.png`, `screens-360-01-list-top.png`.

### C. Status is unreadable at a glance

Row pills (`:1819`, `:1828`, `:1839`) pack **STATUS + 🛡️cache + Clock"30s ago"** onto one
line that clips. The cache chip is `🛡️ ready` / `🛡️ none` (emoji-only semantics) and the
engine chip is `Cr120` / `⚠ Cr83` — operator-hostile jargon with no label. Pills are
~23 px tall (cache ~38 px), too small to be the primary status signal a phone needs.

### D. The ungrouped "Move to group" control is invisible on touch

`page.tsx:1994` wraps the move-to-group `<select>` in
`opacity-0 group-hover/item:opacity-100`. **Phones have no hover** → the only way to
assign an ungrouped screen to a group from the list is permanently invisible on mobile.

### E. Map: tall, legend buried, pins tiny + overlapping

- `ScreenMap.tsx:145` hardcodes **`h-[600px]`** (and `ScreenMapClient.tsx:14` the loading
  skeleton at `h-[600px]`). Measured map height **598 px** = 71–75 % of the viewport.
- Legend (`ScreenMap.tsx:200`, `flex flex-wrap gap-3`) wraps its **6 status items to the
  full viewport height** and sits *below* the 598 px map — you scroll a long way to read
  what the colors mean.
- Pins are **`24×24 px`** (`buildIcon` / `.edu-pin` `:227`) and **overlap with no
  clustering** (markercluster was explicitly dropped, `ScreenMap.tsx:15`). On a phone you
  can't reliably tap the right one of a cluster.
- The map's bottom + the legend are occluded by the fixed `MobileTabBar` (z-60, ~64 px)
  and the bug-report FAB.

> Screenshots: `screens-390-06-map.png`, `screens-390-06b-map-scrolled.png`.

### F. What's actually GOOD (so we don't regress it)

- **Pair modal** (`page.tsx:2053`): `max-w-md`, `max-h-[92vh] overflow-y-auto`, full-width
  inputs, a big centered code field, working QR expand. Measured **358 px wide, fits
  height**. This is the template the rest of the tab should copy. (`screens-390-04/05`.)
- **Gear popover** (`ScreenSettingsMenu`, `:772`): viewport-anchored, flips above/below by
  available space, caps its own height + scrolls internally, **256 px wide, fully
  on-screen**. Well-engineered — the problem is only that the button to *open* it is
  clipped (B above). (`screens-390-03-gear-popover.png`.)
- **Floor plans tab** (`FloorPlansView embedded`): `grid-cols-1` on mobile, compact action
  row, toolbar fits because Pair/New Group are correctly hidden in this mode.
  (`screens-390-07-floorplans.png`.)

---

## Ranked fix punch-list

### P0 — UNUSABLE / blocks the core task one-thumb

- **P0-1 · Reflow the per-screen row into a mobile card.**
  `page.tsx:1744` (group) **and `:1953` (ungrouped)`** — the single biggest fix.
  Replace the flat `flex items-center gap-3.5` with a responsive layout: a stacked card on
  `< sm` (name on its own line; a status row of pill + cache + ping; an **action row** of
  full-size 44 px buttons), reverting to the current single-line row at `sm:`. Until this
  lands, delete + settings + set-location are **untouchable** for every screen.

- **P0-2 · Bring the row action buttons on-screen and to ≥44 px.**
  Same two row blocks (buttons at `:1855`, `:1870`, `:1882` / `:2026`, `:2033`). They are
  `p-2` (34 px) and currently render at x=436/484 in a 390 px viewport. In the new mobile
  card put them in a left-aligned action row with `min-h-11 min-w-11`.

- **P0-3 · Fix the toolbar overflow — "New Group" is clipped off-screen.**
  `page.tsx:1503` (`flex gap-2 items-center`) and the buttons at `:1548`/`:1555`. On mobile
  stack/wrap the controls (e.g. the 3-segment toggle on its own full-width row; Pair + New
  Group as a 2-up row or collapse New Group into an overflow "⋯"). At 390 px today
  "New Group" is 60 px off-screen and unreachable.

- **P0-4 · Surface the ungrouped "Move to group" control on touch.**
  `page.tsx:1994` — drop the `opacity-0 group-hover/item:opacity-100` wrapper (no hover on
  phones). Make the `<select>` always visible in the mobile card's action row.

- **(P0-ENV) · Fix the `font-[family-name:var(--font-fredoka)]` Turbopack CSS corruption.**
  Not a Screens bug, but it 500s every authed route under the default dev/build path (see
  "Environment note"). Either fix the Tailwind arbitrary value (e.g. define a real
  `font-heading` utility / `@theme` token and use a plain class), or pin the toolchain.
  Blocks ALL mobile work, not just this tab.

### P1 — badly degraded but task still (barely) completable

- **P1-1 · Make status legible at a glance.** Rework the row's pill cluster
  (`:1819`/`:1828`/`:1839`): one clear status pill with a word, cache state with a *labeled*
  chip ("Emergency cache: ready/none") instead of bare `🛡️`, and de-jargon `Cr83`→a labeled
  "Old browser" warning. Drop the engine chip on mobile or move it into the gear drawer.
- **P1-2 · Shrink the map to the phone.** `ScreenMap.tsx:145` + `ScreenMapClient.tsx:14`:
  make the height responsive (`h-[60svh]` capped, not a fixed 600 px), and **move the
  legend above the map** (or make it a collapsible chip strip) so the colors are explained
  before you scroll 600 px.
- **P1-3 · Bigger, clustered map pins.** `ScreenMap.tsx` `buildIcon`/`.edu-pin` — bump pin
  hit-area to ≥36–44 px on touch and add `leaflet.markercluster` (was deferred) so dense
  buildings don't render an untappable pin pile.
- **P1-4 · Reclaim vertical space above the fleet.** The "How to Connect a Screen" banner
  (`:1628`) is a full screen-height of onboarding above the actual list. On mobile collapse
  it to a one-line "Pair a screen →" affordance (or hide once ≥1 screen exists).
- **P1-5 · Tab-bar / FAB occlusion on the Map + Floor tabs.** Ensure the map block and its
  legend clear the fixed `MobileTabBar` (z-60) and bug FAB — add bottom padding inside the
  map view, or `useOverlayLock` while the map is the active view.

### P2 — polish

- **P2-1 · Make the fleet KPI tiles tappable filters** (Total/Online/Offline/Emergency →
  filter the list). High value, low cost; the numbers are already computed.
- **P2-2 · Map popup → real actions.** Give the pin popup the "Open player / Sync /
  Trigger here / drill in" buttons the Sprint 8 drill-panel spec promises, so the map is
  more than a read-only dot field on a phone.
- **P2-3 · Inline rename ergonomics.** The tap-to-rename target is the wrapped multi-line
  name; once the card reflow (P0-1) lands, give rename its own pencil affordance + a proper
  mobile input row.
- **P2-4 · Mock-image robustness** is N/A (audit artifact), ignore.

---

## 3 concrete redesigns for the Screens LIST on a phone

**1) Replace the flat row with a real mobile screen-card (the core fix).**
Per screen, on `< sm`:
```
┌────────────────────────────────────────────┐
│ ● Main Lobby Welcome Display            [⚙] │  ← status dot + name (1–2 lines) + ONE menu
│   🟢 ONLINE · synced 30s ago                 │  ← single status line, words not emoji
│   🛡 Emergency cache ready · 1920×1080        │  ← secondary line (labeled)
│   [ Set location ] [ Move to group ▾ ] [ 🗑 ]│  ← 44px action row, all on-screen
└────────────────────────────────────────────┘
```
One row of trailing actions becomes a single overflow `[⚙]` (which already opens the
well-built popover) **plus** an always-visible action row — nothing off-screen, nothing
hover-gated. Cap card height so the fleet scans in a few thumb-flicks, not 8 full screens.
*Touch point: `page.tsx:1744` + `:1953`; reuse the popover at `:772`.*

**2) Sticky, tappable status filter bar; demote the onboarding banner.**
Turn the existing FleetSummary tiles (`:265`) into a sticky horizontal filter chip row
(All · Online · Offline · 🚨 Emergency · Cache: none) that filters the list in place, and
collapse the "How to Connect" banner (`:1628`) to a one-tap row once the tenant has any
screen. A district admin's morning question on a phone is "which screens are red?" — make
that one tap, above the fold, instead of scrolling past onboarding + 294 px cards.

**3) Make the toolbar a phone toolbar.**
Stack it: full-width segmented control row (List / Map / Floor) on top; a primary
**Pair Screen** button below it; push **New Group** into the page (e.g. a "+ New group" row
at the top of the groups list, or an overflow "⋯"). Mirror the pattern Floor-plans mode
already proves works (it fits precisely because it shows fewer controls). *Touch point:
`page.tsx:1503`.*

---

## Files where fixes land (all absolute)

| Fix | File:line |
|---|---|
| Per-screen row reflow + action buttons (group) | `/Users/gschiemann/Desktop/EDU CMS/apps/web/src/app/[schoolId]/screens/page.tsx:1744` |
| Per-screen row reflow + action buttons (ungrouped) | `…/apps/web/src/app/[schoolId]/screens/page.tsx:1953` |
| Status / cache / ping pill cluster | `…/screens/page.tsx:1819`, `:1828`, `:1839` |
| Ungrouped hover-gated "Move to group" select | `…/screens/page.tsx:1994` |
| Toolbar overflow (view toggle + Pair + New Group) | `…/screens/page.tsx:1503`, `:1548`, `:1555` |
| "How to Connect" onboarding banner | `…/screens/page.tsx:1628` |
| Fleet KPI tiles → tappable filters | `…/screens/page.tsx:265` (FleetSummaryStrip) |
| Map fixed `h-[600px]` + legend order + pin size/cluster | `…/apps/web/src/components/screens/ScreenMap.tsx:145`, `:200`, `:227`; loading skeleton `…/components/screens/ScreenMapClient.tsx:14` |
| Map popup → real actions | `…/components/screens/ScreenMap.tsx:168` |
| Gear popover (already good — don't regress) | `…/screens/page.tsx:772` |
| Pair modal (already good — copy this pattern) | `…/screens/page.tsx:2053` |
| Floor plans tab (already good) | `…/apps/web/src/components/screens/FloorPlansView.tsx:33` |
| Turbopack CSS corruption (env P0) | `…/apps/web/src/app/globals.css` + `…/apps/web/src/app/layout.tsx:21` (`--font-fredoka`) |

## Screenshot index (`scratch/mobile-ux-audit/`, gitignored)

- `screens-390-01-list-top.png` / `screens-360-01-list-top.png` — toolbar clip, "New Group" off-screen
- `screens-390-02-group-rows.png` / `screens-360-02-group-rows.png` — **the unusable 294 px row, action buttons gone**
- `screens-390-03-gear-popover.png` — drill-in popover (well-built once open)
- `screens-390-04-pair-modal.png` / `screens-360-04` — pair modal (good)
- `screens-390-05-pair-qr.png` — QR expand (good)
- `screens-390-06-map.png` — map view (598 px tall)
- `screens-390-06b-map-scrolled.png` — map pins overlapping + legend below fold
- `screens-390-07-floorplans.png` — floor plans tab (good)
