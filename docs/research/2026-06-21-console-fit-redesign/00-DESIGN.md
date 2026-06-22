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

## MOBILE — chosen: full-bleed three-band console (NEW md:hidden subtree)
Sticky compact header (HOME score · clock+seg · AWAY score + game-state chip + ⋮ overflow sheet for
role-switch / status / surfaces / send-to-device) → segmented tab strip (Score | Celebrate | Roster |
Ribbon, tabs gated by the existing role booleans) → `flex-1` tab body (Score = the promoted full-height
`MobileScoreDock` score columns + celebration overlay, or `MeetResultsSection` for judged/leaderboard;
Celebrate = `RunInlineCuesBar`; Roster = `RunInlineRosterBar` default-expanded; Ribbon = `RunRibbonPreview`)
→ persistent bottom dock (clock Start/Stop + segment ± + reset + sport-tray macros) always visible in every
tab. Fills 100% of the screen, zero void, every function ≤2 taps. App basis: GameChanger's fullscreen
simplified controls, edge-anchored primary actions.

**KEY correction the synthesis caught:** `RunRibbonPreview` / `RunInlineRosterBar` / `RunInlineCuesBar`
(page.tsx:1533-1546) render in the SHARED cluster (gated by VIEW role, NOT breakpoint). So the safe move is
to ADD a `md:hidden` mobile tab tree and gate the EXISTING tree `hidden md:*` — the shared bars render twice
(one hidden), zero data-layer change. Hard merge point with the desktop fix: gating the 3 chrome rows +
splitting the 1466-1590 branch into `hidden md:*` desktop + new `md:hidden` mobile. Refactor `MobileScoreDock`
into `DockTeamCols` (Score tab) + `DockClockStrip` (bottom dock) WITHOUT rewriting the operator-validated
56px targets / team-color borders / safe-area. **STATUS: speced, build next (separate commit) — mockup +
adversarial review + operator device sign-off before/at ship.**

## Verification (both)
The authed console can't render under `next dev` (Fredoka font bug, task #205), so: tsc · `pnpm
mobile-perf-guard` · adversarial review against the real file · CI green · operator confirmation on the real
PC monitor + iPhone. Where feasible, a Playwright-vs-live screenshot at the target viewports.
