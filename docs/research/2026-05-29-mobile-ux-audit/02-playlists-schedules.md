# Mobile UX Audit — Playlists + Schedules (slice 02)

**Date:** 2026-05-29
**Auditor:** Senior mobile-UX + front-end (read-only audit)
**Devices:** Chromium @ **390×844** (iPhone 14/15) and **360×800** (small Android), `isMobile`+`hasTouch`, iOS Safari UA
**Method:** Live dev server (isolated worktree on :3012, webpack), full API mocked in Playwright with credentialed CORS (Origin echoed, `Allow-Credentials: true`), SCHOOL_ADMIN session injected. Every screen + every wizard step + every key state screenshotted at both viewports → `scratch/mobile-ux-audit/playlists-<vp>-NN-*.png` (40 shots).
**Scope (assigned):** `/[schoolId]/playlists` list + cards + **PlaylistCreateWizard** (all 5 steps on a phone), and the scheduling UI. **Note on scope:** there is **no** standalone `/[schoolId]/schedules` route — `apps/web/src/app/schedules/page.tsx:7` is a client redirect to `/playlists`. **All scheduling lives inside the Playlists page**: (a) the wizard's Step-4 "Publishing" sub-form, (b) the playlist-detail "Publish to Screens" bottom-sheet, (c) per-slide time-restriction in the editor's gear panel. I audited all three.

---

## Headline

The Playlists area is, for the most part, **the best-built mobile surface I've seen in this codebase** — the create wizard's steps 1/2/3/5, the detail editor, and especially the detail "Publish to Screens" **bottom sheet** are genuinely thumb-friendly and look like a paid product. **But two things are outright broken on a phone, and both sit on the critical "create a playlist and schedule it" path:**

1. **The wizard's Step-4 schedule sub-form clips its end-time and end-date inputs off the right edge of the screen** — you literally cannot set an end time/date when creating a playlist on a phone. (P0)
2. **The "Line" (compact) list view renders the playlist name at 0px width — the name is invisible.** (P0)

There is also a **third, structural problem**: the schedule editor exists **twice** with **divergent quality**. The detail-view "Publish" sheet does dates/times *correctly* (stacked, `flex-1`, no clip). The wizard's Step-4 form was hand-rolled separately and gets it *wrong*. Same task, two code paths, one polished and one broken.

Net: a determined operator **can** complete "create a playlist + schedule it" on a phone in ~60–90s **if** they (a) use "Activate immediately" in the wizard or leave scheduling for later, then (b) schedule via the detail Publish sheet. The "happy path" the wizard advertises (schedule inside the wizard) is broken on mobile.

---

## Coverage table — Design / UX / Functionality at phone width

| # | Surface | D | UX | F | One-line verdict |
|---|---|---|---|---|---|
| 1 | Playlists list — header + stats + filters | A− | B | A | Stats 2×2 grid + filter selects fit; filter selects are tiny (`py-2 text-xs`). |
| 2 | Playlists list — **Grid/Tile card** | A− | B+ | A | Clean; delete button is hover-only (invisible on touch). |
| 3 | Playlists list — **Line/compact card** | C | **D** | **D** | **Name renders at 0px width — invisible.** Row over-packed. |
| 4 | Wizard Step 1 — Name & type | A | A | A | Exemplary. Big cards, good input, clear footer. |
| 5 | Wizard Step 2 — Media picker grid | A− | B+ | A | 2-col tap-to-toggle works; checkbox affordance hover-only (state still shows). |
| 6 | Wizard Step 2 — **Selected-media drawer (reorder + duration)** | B | **C** | B− | Drag handle 20×20px (sub-44); drawer+footer eat ~45% of viewport; **PointerSensor-only (no TouchSensor) → known iOS long-press race**. |
| 7 | Wizard Step 3 — Pick screens | A | A | A | Single-column cards, search, skip link. Great. |
| 8 | Wizard Step 4 — Publish ("Activate immediately") | A | A | A | Big radio cards, clear copy. |
| 9 | Wizard Step 4 — **"Schedule a window" sub-form** | C | **D** | **F** | **End time + end date clipped off-screen** (right edge 514px in a 360–390px modal). Form controls nested inside a `<button>` → React hydration error. |
| 10 | Wizard Step 5 — Review | A | A | A | Clean summary table + Create button. |
| 11 | Detail — Editor (dnd reorder + duration) | A− | B+ | A | Grip-only drag + `touch-action:none` + TouchSensor delay:150 = correct iOS pattern. Duration input 48×26px small. |
| 12 | Detail — per-slide gear "scheduling" panel | B | B− | B | Time inputs in a `flex gap-4` pair; OK but cramped; nested in expanding card. |
| 13 | Detail — Schedules tab (read-only cards) | A− | B+ | A | Schedule cards read well; action icons 36px tall (slightly sub-44). |
| 14 | Detail — **"Publish to Screens" bottom sheet** | A | A | A | **Reference-quality**: bottom sheet, drag handle, safe-area, sticky `flex-1` footer, dates **stacked** (no clip). This is how the wizard should do it. |
| 15 | Asset picker modal (in editor) | A− | B+ | A | Bottom-ish modal, upload-inline, multi-select. Fine. |

Legend: **F** = broken, **D** = severe gap, **C** = rough, **B** = usable, **A** = ship-quality. Anything ≤ B is a gap.

---

## P0 — must fix (broken on the critical path)

### P0-1 · Wizard Step-4 "Schedule a window": end time + end date are clipped off the right edge — unsettable on a phone
**File:** `apps/web/src/components/playlists/PlaylistCreateWizard.tsx:2222` (time row) and `:2251` (date row).
**Evidence:** measured input geometry (both viewports identical because widths are fixed, not fluid):
- time inputs: start `x=110→246`, **end `x=277→413`** — right edge 413px in a **360px** modal (53px clipped).
- date inputs: start `x=110→277`, **end `x=347→514`** — right edge **514px** in a 360–390px modal (**~124–154px clipped**).
- Screenshot `playlists-360-11-wizard-step4-scheduled-subform.png` shows "TIME OF DAY: 08:00 AM ⟶ TO ⟶ 03:00 **P…**" with the end input sheared at the screen edge.

**Cause:** `<div className="flex items-center mb-3 text-xs">` (time) and `<div className="flex items-center text-xs">` (date) put two native `<input type="time">`/`<input type="date">` side-by-side with a "to"/"through" label between them, **no wrapping, no `flex-1`, no stacking breakpoint**. Native date/time inputs have a large intrinsic min-width (~135–167px here); two of them + a label can't fit in ~328px of usable modal width.

**The fix already exists 200 lines away.** The detail-view Publish modal solves the identical problem correctly at `apps/web/src/app/[schoolId]/playlists/page.tsx:2353`: `className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2"` + each input `flex-1`. Screenshot `playlists-360-18-publish-modal-footer.png` proves it — two `mm/dd/yyyy` inputs **stacked vertically**, fully visible. Port that exact pattern (stack on mobile, row on `sm:`, `flex-1` inputs) to the wizard's time + date rows.

### P0-2 · Wizard Step-4 form controls are nested inside a `<button>` → invalid HTML + React hydration error
**File:** `apps/web/src/components/playlists/PlaylistCreateWizard.tsx:2165` — the entire "Schedule a window" card is `<button onClick={() => setActivate(false)}>`, and the day-picker buttons (`:2200`), time inputs (`:2223`), and date inputs (`:2252`) all render **inside** it.
**Evidence:** every page load that reaches Step 4 logs:
> `In HTML, <button> cannot be a descendant of <button>. This will cause a hydration error.`
(captured in both 390 and 360 console runs; React even prints the offending ancestor stack pointing at the `setActivate(false)` button and the `bg-sky-600` day button).

**Why it matters:** (a) it's a real hydration error on a life-safety-adjacent product; (b) it's the reason the code is littered with `e.stopPropagation()` on every input/day-button — they're fighting the parent button's click. Nested interactive controls also break keyboard/AT semantics and can mis-fire taps on touch. **Fix:** make the card a `<div role="radio">` (or a plain div with an `onClick` region for the header only) so the schedule controls are legitimate siblings, then drop all the `stopPropagation` band-aids.

### P0-3 · "Line" (compact) list view: playlist name renders at 0px width — invisible
**File:** `apps/web/src/app/[schoolId]/playlists/page.tsx:454` — `<div className="... flex items-center gap-4 px-4 py-3 pointer-events-none">` packs, in ONE non-wrapping row: 56×40 thumb + name `<h3>` + a 4-item metadata strip (`:472`, slides/creator/updated/schedule-count) + online chip + Live chip + 44px toggle + delete + chevron.
**Evidence:** measured the name `<h3>` in line view → `nameClientW: 0`, `nameScrollW: 212`, `truncated: true`, `nameRight: 105` at **both** 360 and 390. The name is squeezed to zero rendered width while holding 212px of text. Screenshot `playlists-360-02-list-line.png`: the line-view row shows the thumbnail, "MIXED CONTENT", "4 slides", a Live toggle, a date, "1/2", "3/3 online" — **but no playlist name at all.**

**Cause:** too many fixed-width siblings competing in one flex row; the metadata strip (`:472`, with its own `gap-3` and a `max-w-36` creator span at `:474`) plus three trailing controls leave the `flex-1 min-w-0` name container nothing to occupy, so `flex-shrink` collapses it to 0.
**Fix:** on mobile, give the name its own full-width line (drop to a 2-row layout under `sm:`), and **hide the metadata strip + creator on mobile** (show only name + Live chip + toggle + chevron). The Tile view already does the right thing — Line view just needs a mobile breakpoint. Simplest: hide the `:472` metadata row on `< sm` (`hidden sm:flex`) and let the name take the full width.

---

## P1 — should fix (rough, hurts the core flow)

### P1-1 · Wizard reorder uses PointerSensor-only — the documented iOS long-press race
**File:** `apps/web/src/components/playlists/PlaylistCreateWizard.tsx:1537-1540` — `useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, …))`. **No `TouchSensor`.**
**Why this is a real bug, not a guess:** the SAME file's sibling editor on the detail page deliberately uses a **different** sensor set *specifically to fix iOS*, with a multi-paragraph comment at `apps/web/src/app/[schoolId]/playlists/page.tsx:1054-1073`:
> "a single PointerSensor with `distance: 8` … on iOS … loses the race against Safari's built-in long-press handler … dnd-kit never gets to start the drag … The fix: MouseSensor `distance:8` + **TouchSensor `delay:150ms` tolerance:6**."
The wizard never received that fix. So the wizard's "drag to reorder" (its headline Step-2 feature) will exhibit exactly the iOS long-press / text-selection / copy-lookup-translate menu the team already diagnosed and fixed elsewhere. (My synthetic-touch reorder attempt was inconclusive — Playwright can't faithfully reproduce the iOS PointerEvent stream dnd-kit needs — but the source contradiction is definitive: one path is iOS-hardened, the other isn't.)
**Fix:** copy the detail editor's sensor block (MouseSensor + TouchSensor delay:150 + KeyboardSensor) into the wizard's `SelectedMediaDrawer`.

### P1-2 · Wizard drag handle is a 20×20px target (sub-44 minimum)
**File:** `apps/web/src/components/playlists/PlaylistCreateWizard.tsx:1653-1660` — handle `className="w-5 h-5 … touch-none"` (`touch-none` is correct; the size is not). Measured `handleW:20, handleH:20`.
The detail editor's grip is `28×36px` (`page.tsx:220-228`, `px-1 py-2`) — still under 44 but far more grabbable. Apple HIG / WCAG 2.5.5 want **44×44**. **Fix:** pad the wizard handle to ≥44×44 (`p-2.5` around the icon) and bump the icon to `w-5 h-5`.

### P1-3 · Two divergent schedule editors — consolidate
The wizard's Step-4 schedule form and the detail "Publish to Screens" sheet implement the *same* concept (days / time window / date range / mute) with **different markup and different mobile behavior** — one broken (P0-1/P0-2), one excellent (#14). This is the root cause of P0-1: the good fix was never shared. **Fix:** extract a single `<ScheduleWindowFields>` component (days + time + date, mobile-stacked, brand-honoring) and render it in BOTH the wizard Step 4 and the Publish sheet. Kills the divergence permanently.

### P1-4 · Tap targets sit below 44px across the schedule surfaces
Measured at both viewports:
- Publish-sheet **day buttons**: 33–42px wide × **29px tall** (`page.tsx:2386-2399`, `px-2.5 py-1.5`).
- Wizard Step-4 **day buttons**: `px-2.5 py-1` ≈ 24px tall (`PlaylistCreateWizard.tsx:2208`).
- Detail editor **duration `<input type=number>`**: 48×**26px** (`page.tsx:266`, `w-12 py-1`, `data-allow-small-input` opts OUT of the 16px iOS-zoom floor — intentional, but the box is tiny to hit).
- Schedule-card action icons (edit/pause/delete): **36px** tall (`page.tsx:1799-1818`, `p-1.5`).
None are unusable, but a 7-day row of 29px-tall buttons on a phone is fat-finger territory. **Fix:** floor interactive controls at 40–44px tall in these dense rows; the day pickers especially should be ~40px tall with a touch of horizontal breathing room.

### P1-5 · Selected-media drawer + footer consume ~45% of the viewport while you're still picking
**File:** `PlaylistCreateWizard.tsx:1046-1055` (drawer) + `:1057` (footer). In Step 2, once ≥1 asset is picked, the pinned `SelectedMediaDrawer` (header + `max-h-44` list, `:1590`) AND the wizard footer occupy the lower ~half of the modal, leaving only ~2.5 picker tiles visible above. Screenshot `playlists-360-06-wizard-step2-selected-drawer.png`. The operator must scroll a small picker viewport to add items while simultaneously scrolling a small drawer to reorder/time them. On a phone this is a cramped two-pane fight.
**Fix:** on mobile, collapse the drawer to a single summary bar ("4 selected · tap to manage") that expands to a full-height sheet on tap, instead of permanently splitting the modal.

---

## P2 — polish

- **P2-1 · Hover-only controls invisible on touch.** Grid-card **delete** button is `opacity-0 group-hover:opacity-100` (`page.tsx:513`); wizard media-picker **checkbox** is `opacity-0 group-hover:…` (`PlaylistCreateWizard.tsx:1457`). Touch has no hover. The checkbox is forgiven (selected state shows it; whole tile toggles), but the **delete** action is genuinely undiscoverable on a phone — an operator can't delete a playlist from the list on mobile. Make destructive/primary affordances always-visible at `< sm` (the detail editor already does `text-slate-400 md:opacity-0` — apply the same here).
- **P2-2 · Filter bar is tiny on mobile.** Four `<select>` at `py-2 text-xs` in a `grid-cols-2` (`page.tsx:2577-2608`). They work but read as desktop-shrunk. Consider a single "Filters" button → bottom sheet on mobile.
- **P2-3 · Wizard modal uses `maxHeight: 90vh` (not `dvh`) + scrim `padding:16`** (`PlaylistCreateWizard.tsx:856, 867`). The detail Publish sheet correctly uses `max-h-[90dvh]` + `pb-[env(safe-area-inset-bottom)]` and renders as a true bottom sheet. The wizard is a centered card; on a phone a **full-height bottom sheet** (like the Publish modal) would give every step more room and put the footer in thumb reach. At minimum switch `90vh`→`90dvh` so the iOS URL bar doesn't clip the footer.
- **P2-4 · Detail header action row is tight.** "Add Media / Download / Publish" (3 buttons) crowd at 360px (screenshot `…-13-detail-editor.png`). They fit, but a fourth action would break it. Watch this.
- **P2-5 · Three-buttons-in-a-row wizard footer.** Back (left) + Cancel + Next (right) all in one `py-2` row (`PlaylistCreateWizard.tsx:1058-1112`). Buttons are ~32px tall and Cancel sits between Back and Next — easy mis-tap. Consider dropping "Cancel" (the X in the header already closes) and making Back/Next larger `flex-1`-ish targets, mirroring the Publish sheet's generous `flex-1 py-2.5` footer.

---

## What's genuinely good (don't regress these)

- **Detail "Publish to Screens" bottom sheet** (`page.tsx:2212-2474`): textbook mobile modal — `items-end md:items-center`, drag-handle hint, `max-h-[90dvh]`, `safe-area-inset-bottom`, sticky `flex-1` footer, **stacked** date inputs. This is the template for every other modal in the app.
- **Detail editor reorder** (`page.tsx:198-289` + sensors `:1069`): grip-only drag, `touch-action:none` + `WebkitTouchCallout:none` to kill iOS's copy/lookup menu, responsive chrome that sheds the index number / mime label / "sec" label on mobile. Well-reasoned, well-commented.
- **Wizard steps 1/2/3/5**: clear step indicator, jump-back dots, big tap-target type cards, single-column screen picker, clean review table. Steps work one-thumb.
- **No horizontal body overflow** on the list at either viewport (`overflowX: 0`).
- **`useOverlayLock`** hides the bottom tab bar whenever the wizard / sheet is open, so footers clear the 56–64px tab strip (`PlaylistCreateWizard.tsx:336`).

---

## Ranked fix list (do in this order)

1. **P0-1** — wizard Step-4 stack the time + date inputs (port `page.tsx:2353` pattern). *Unblocks scheduling in the wizard on mobile.*
2. **P0-3** — line-view: full-width name + hide metadata strip on `< sm`. *Makes the compact list readable.*
3. **P0-2** — un-nest the schedule controls from the `<button>` in Step 4 (kills the hydration error).
4. **P1-3 + P1-1** — extract one `<ScheduleWindowFields>` with the iOS-hardened sensor set; use it in both the wizard and the Publish sheet. *Fixes P0-1/P0-2/P1-1 structurally and prevents recurrence.*
5. **P1-2 + P1-4** — bump drag handle + day buttons + duration inputs + schedule-card icons to ≥40–44px.
6. **P1-5** — collapse the Step-2 selected-media drawer to an expandable summary on mobile.
7. **P2-1** — always-visible delete/primary affordances on `< sm`.
8. **P2-3 / P2-5** — wizard → full-height bottom sheet (or at least `90dvh`); slim the footer to Back/Next.

---

## Test harness (reproducible)

- `scratch/mobile-ux-audit/playlists-audit.mjs` — main pass (40 shots, geometry probes).
- `scratch/mobile-ux-audit/playlists-followup.mjs` — line-row clip + touch-drag + slide-settings probes.
- Run: isolated worktree dev server on :3012 (`next dev --webpack`), then `node scratch/mobile-ux-audit/playlists-audit.mjs`. Mocks echo Origin + `Allow-Credentials:true`; auth injected via `edu_cms_user`/`edu_cms_token` localStorage keys (matches `ui-store.ts:27-28` bootstrap).
- Screenshots: `scratch/mobile-ux-audit/playlists-{360,390}-NN-*.png`.
