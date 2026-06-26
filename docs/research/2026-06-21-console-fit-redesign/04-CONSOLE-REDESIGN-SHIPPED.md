# Sports console — "One Smart Bar + Broadcast Desk" SHIPPED (2026-06-24)

Operator picked **all-in-one-push** for the approved "One Smart Bar + Broadcast
Desk" redesign (over slice-by-slice). Shipped as commit **`a4cbb87`** (single
push, after the player-stats track landed green at `9df4df7`).

## What changed (2 files; ShowControlPanel.tsx unchanged — only its mount moved)

### `RunCommandBar.tsx` (the single Run-mode top bar) — absorbed the old page-header
- Added: Back (arrow) · the four live-surface launchers **Ribbon / Scoreboard /
  Stream / Keys** as a compact icon group · a **Set up** jump. (These were a whole
  second toolbar row before.)
- Status-transition buttons (`statusButtons`) now gated by a new **`statusOnBoard`**
  prop: when a board is on-screen they're `md:hidden` here (desktop shows them on
  the board corner); in the boardless Show Caller / PA views they show on **all**
  breakpoints so a desktop operator never loses Go Live / Halftime / Final.
- a11y: every icon-only button has `aria-label` (added one to the penalty button).

### `page.tsx`
- **Page-header → Setup-mode only** (`{mode === 'setup' && (...)}`). In Run mode
  RunCommandBar is the ONLY top bar. Removed the two now-unreachable
  `{mode === 'run'}` Stream/Keys buttons from the setup header (they're in the bar).
- Plumbed 7 callbacks parent → RunMode → RunCommandBar: `onBack`/`onSetup`/
  `onRibbon`/`onScoreboard`/`onStream`/`streamCopied`/`onShortcuts` (+ `statusOnBoard`).
- **Status transitions fused to the board's top-right corner on desktop**
  (`hidden md:block absolute top-2 right-2`, white pill over the dark board so the
  light transition buttons read).
- **Two-column broadcast desk INSIDE the score region** (NOT a new top-level
  wrapper — preserves the constraint):
  - Outer: `flex flex-col … overflow-y-auto md:grid md:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)] md:overflow-hidden`
  - LEFT (Game control): `contents md:flex md:flex-col md:min-h-0 md:overflow-hidden md:border-r` → scoreFitRef (scoreboard hero + status corner) + pinned dock + sport tray.
  - RIGHT (Presentation): `contents md:flex md:flex-col md:min-h-0 md:overflow-y-auto` → ShowControlPanel (Back-to-live at top) + ribbon + roster + cues.
  - **Mobile unchanged**: `contents` dissolves both columns into the single
    full-bleed scrolling deck; `useConsoleFit` still measures `scoreFitRef`
    (kept `md:flex-1` in the LEFT column).

## Verification
- tsc (web) 0 errors · `next build` compiled successfully · mobile-perf guard clean ·
  Taurus unaffected (no new `inset`/`inset-0`; sports console isn't a Taurus target).
- **Adversarial review** (workflow, 3 lenses — structure / regression / a11y-perf):
  structure = ship; the other two flagged 1 **must-fix** + 1 **should-fix**, both
  applied before push:
  - must-fix: desktop status transitions were unreachable in Show Caller / PA views
    (board-corner pill gated by `showScoreboard`, command-bar copy `md:hidden`) →
    fixed with the `statusOnBoard` prop.
  - should-fix: penalty button had no accessible name → added `aria-label`.

## OPEN — operator's eyes on the live deploy (can't render authed console locally, #205)
1. Run mode shows ONE top bar (no stacked second row).
2. Desktop: two columns (board left, presentation right); Halftime/Final on the board corner.
3. Show Caller / PA views (desktop): status transitions still reachable in the bar.
4. Mobile: still one full-bleed scrolling deck, no horizontal pan, all controls reachable.
5. Set up ⇄ Run navigation both directions.

Deferred (not in this push): ⌘K command palette; narrow-column vertical reflow of the
presentation strips (they currently degrade via overflow-x-auto in the right column).
