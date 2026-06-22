# Sports Run console — fit-to-one-pane (desktop) + full-bleed (mobile) redesign — 2026-06-21

> Greg: (PC) "the scoreboard needs to auto resize on the PC so the controls always fit in one pane
> and the operator can control the entire game without scrolling … see how modern competitors do it
> and match or beat it." (Mobile) "so much wasted space in the mobile controller … it should take up
> the ENTIRE display so we get all the functionality and it's super easy to use."
>
> Two parallel multi-agent workflows (understand → competitor/app research → 3-design panel →
> synthesis). Raw agent output: `desktop-raw-workflow.json`, `mobile-raw-workflow.json` (this folder).

## Root cause (shared)
The console is a fixed `100dvh−64px` flex column: chrome rows (switch-view + game-state + screens ≈164px)
→ `flex-1 overflow-y-auto` scoreboard region → `shrink-0` pinned stack (ribbon ≤140px + roster + cues +
tray). The scoreboard's centre clock tile is hard `min-h-[280px]` + team tiles `min-h-[220px]` + text-8xl
clock. On a laptop the chrome + pinned stack leave the `flex-1` region shorter than that fixed content →
it scrolls and the clock CONTROL row clips. On **mobile** the desktop tiles are `hidden md:grid` so the
`flex-1` region holds only the ~90px `MobileScoreMirror` → a ~310px dead void between the mirror and the
bottom dock.

## DESKTOP — chosen: measured 3-tier density downshift (no transform on controls)
`useConsoleFit(regionRef, enabled)` (NEW `use-console-fit.ts`) measures the scoreboard region and steps
density down `normal → compact → tight` (smaller clock/score font, logo, paddings, min-heights) until the
content fits — self-correcting (downshift while `scrollHeight > clientHeight`), so it's immune to threshold
mis-tuning. Control BUTTONS never shrink (stay ≥44px). No `transform:scale` on the interactive grid (the
repo's FitOneLine docstring + CLAUDE.md warn it breaks hit-targets); the region keeps its `overflow-y-auto`
as a documented last resort on pathologically short windows. The celebration overlay is untouched (no
transform wrapper added). At `tier='normal'` the classes are byte-identical to before → tall screens
unchanged. Competitor basis: OES/Daktronics/vMix keep a fixed, always-visible control surface (one pane,
no navigation). **STATUS: implemented, tsc+mobile-perf clean — shipping first.**

## MOBILE — chosen by Greg: NO-TABS single scrolling deck (minimal responsive reflow)
The workflow synthesis proposed a tabbed three-band console; I mocked it + offered Greg the shape choice and
**he picked "no tabs — one scrolling deck."** So the SHIPPED approach is the far-lower-risk reflow, not the
tab restructure: on phones the Full/Score branch becomes ONE full-bleed scrolling column (score+clock at top,
then ribbon/roster/cues/tray stacked) with NO dead middle void; the existing components are reused IN PLACE
(no new tab tree, no chrome-row gating, no double-mount).

**Implementation (2 edits at page.tsx:1474):** wrap the `flex-1` scoreboard region + the `shrink-0` pinned
cluster in `<div className="flex flex-col flex-1 min-h-0 overflow-y-auto md:contents">`, and change the
scoreboard region's base classes to `overflow-y-auto md:flex-1 md:min-h-0`. The root-cause of the void was
that the scoreboard region is `flex-1` on mobile while its only mobile content is the ~90px mirror (desktop
tiles are `hidden md:grid`) → a tall empty flex region. Dropping `flex-1` on mobile makes the column
content-height so the deck stacks + scrolls as one, no gap. **`md:contents` dissolves the wrapper at md+** so
the desktop `flex-1` scroll + `shrink-0` pinned split (and the desktop fit hook's `scoreFitRef`) are
byte-identical — zero desktop regression. **STATUS: implemented, tsc+mobile-perf clean, adversarial review +
CI before claiming done; operator confirms on his iPhone.**

(Deferred — the bigger full-bleed tab console from the synthesis — `MobileScoreDock`→`DockTeamCols`+
`DockClockStrip`, header ⋮ sheet, Score/Celebrate/Roster/Ribbon tabs — is preserved in `mobile-raw-workflow.json`
if Greg later wants the tabbed version over the scrolling deck.)

## Verification (both)
The authed console can't render under `next dev` (Fredoka font bug, task #205), so: tsc · `pnpm
mobile-perf-guard` · adversarial review against the real file · CI green · operator confirmation on the real
PC monitor + iPhone. Where feasible, a Playwright-vs-live screenshot at the target viewports.
