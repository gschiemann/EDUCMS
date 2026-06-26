# Mobile Sports Console — one-handed iPhone Run console (2026-06-21)

> Greg: "The mobile sports controls is not usable, we need to be able to run the game from an
> iPhone, make us cutting edge on mobile UX." Grounding + design from an 8-agent workflow
> (4 readers → 3-design judge panel → synthesis). Persisted per Agent Dispatch Protocol rule #8.
> Full agent output: `tasks/wt2tlw3cb.output` in the session transcript dir.

## The confirmed problem (reader analysis, iPhone 14 = 390×844, ~780px usable under the 64px nav)

The live Run console (`apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx`, `RunInteractiveScoreboard`
~line 1988) lays the score control out as `grid grid-cols-1 sm:grid-cols-[1fr_auto_1fr]` (~2021) —
so on a **phone it collapses to ONE column** and the HOME tile / CENTER clock / AWAY tile **stack
vertically**. Consequences for one-handed live operation:
- To score **both** teams on a play you scroll up to HOME +1, then down to AWAY +1 — multi-scroll per score.
- The **clock** (start/stop) is sandwiched in the middle — off-screen on load until you scroll.
- The hot actions (home±, away±, clock) are NOT in the bottom thumb zone; the bottom is the roster/cues bar.
- Touch targets are already ≥44px (good) and the shell uses `dvh` — the failure is **layout/reachability**, not sizing.

## The chosen design — "mirror top · tray middle · dock bottom" (thumb-first)

- **Glanceable mirror (top):** compact, always-visible HOME score – AWAY score + clock + segment + status.
- **Tray (middle, scrolls):** the existing detailed controls / roster / cues remain available.
- **Thumb dock (bottom, the hero):** a 3-column row of GIANT tap targets — **HOME +1 · clock Start/Stop ·
  AWAY +1** — always reachable one-handed, zero scroll. Secondary row: segment ±, timeout, undo, Cues.

## Build constraints (hard rules)
- **Desktop unchanged:** mobile is a `md:hidden` subtree / element; desktop stays `hidden md:flex` (the
  existing console). No desktop regression.
- **Reuse existing mutations** — `ctl.score.mutate({team,delta})`, `ctl.clock.mutate({action,ms})`,
  `ctl.segment.mutate({delta})`, `ctl.callTimeout.mutate({team})`, the cue launchpad. No data-layer rebuild.
- **iOS Safari realities:** `dvh` (not `100vh`); `env(safe-area-inset-bottom)` for the bottom dock;
  `navigator.vibrate` is a **no-op on iOS** → rely on visual press feedback (score flip / ring), not haptics.
- **CLAUDE.md mobile-perf standard:** no background polling, breakpoint-gate any `backdrop-blur`,
  `useShallow` on combined Zustand selectors, `will-change`/`contain` on slide/overlay.
- **Bottom-collision care:** the global `MobileTabBar` + the console's existing pinned-bottom (roster/cues)
  share the bottom; the dock must sit in the console's existing pinned flex-column flow (which already clears
  the tab bar via `-mb-24`), not a naive `position:fixed` overlay that double-stacks.

## Implementation approach (slice 1 — safest high-impact)
A `md:hidden` **Quick-Score thumb dock** rendered as the bottom pinned element of the Run score/full view:
3 columns [HOME +1] [clock Start/Stop] [AWAY +1] (~72px tall, full-width thirds, visual press feedback),
plus a compact secondary row (segment ± · timeout · undo · Cues). The existing scoreboard scrolls above it
as the glanceable detail/mirror. Reuses all `ctl` mutations; desktop hidden via `md:hidden`.

## Verification
tsc · `pnpm mobile-perf-guard` · adversarial review · CI (a11y/cross-browser/Taurus N-A here) · **and Greg's
real iPhone** (the authed console can't be rendered locally under `next dev` due to the Fredoka-500 on authed
routes — task #205 — so pixel polish is Greg's confirmation). Attempt a Playwright/Preview screenshot at
390×844 against the live site where feasible.

## SHIPPED — commit `6713a32` (2026-06-21), pushed to master

Slice 1 landed exactly as designed. In `apps/web/src/app/[schoolId]/sports/[gameId]/page.tsx`:
- **`MobileScoreMirror`** (`md:hidden`) — glanceable HOME score · clock+segment · AWAY score, rendered at the
  top of `RunInteractiveScoreboard`. The full operable tiles are now `hidden md:grid` (desktop-only).
- **`MobileScoreDock`** (`md:hidden`) — 3-col thumb dock [HOME +score / −1] [segment± · clock · Start-Stop ·
  reset] [AWAY +score / −1], mounted as the FIRST child of the pinned-bottom `shrink-0` cluster (guaranteed
  visible if the secondary bars overflow), gated `{showScoreboard && …}`. Returns `null` for judged/leaderboard
  sports (no `def.score.increments`). Score buttons render each sport's real increments with a team-colour
  border (white +N legible on any colour); clockless sports get per-team timeout buttons in the centre column.
  iOS `env(safe-area-inset-bottom)` padding; reuses `ctl.score/clock/segment/callTimeout` (no data-layer change).

**Verification:** `tsc` exit 0 · `pnpm mobile-perf-guard` clean · 3-lens adversarial review (correctness /
desktop-regression / mobile-UX → **ship-with-nits**, 0 must-fix; the one nit — −1 button 40→44px — fixed before
push). Clone-push diff confirmed +277/−1, mobile-console only. **Still needs Greg's real-iPhone confirmation**
(the authed console can't render under `next dev` — Fredoka font bug, task #205 — so pixel polish is his device).

## Deferred (bigger / needs Greg's device review)
Full swipeable role panes; long-press −1 / +N pickers on the dock; a dedicated full mobile console subtree
replacing (not augmenting) the desktop layout; haptics via a future native wrapper. Possible slice-2 items once
Greg sees it on his phone: hide the secondary pinned bars (ribbon/roster/cues) on mobile so the dock sits at the
absolute bottom; a compact mobile cue/celebration launcher; per-team timeout chips on timed sports too.
