# Sports Run console — elegance / IA redesign (2026-06-22)

> Greg: "it seems so fucking messy what you added — are we using the latest UX techniques to make our sports app
> the most elegant and user friendly app anyone has ever seen?" Root cause: I bolted on FOUR stacked full-width
> toolbars above the scoreboard (view/action rail · RunStatusControl · SurfaceHealthPills · ShowControlPanel) —
> ~160-176px of competing-border chrome, no hierarchy. 7-agent workflow (IA/clutter map + best-in-class elegance
> research + design-system grounding → 3 designs → synthesis). Raw: `elegance-raw-workflow.json`.

## Chosen IA — "Progressive-Minimal" (one calm console, zero logic rewrite)
Collapse the 4 strips into:
1. **Command bar** (~44px, glass, single border): game identity + **LIVE/HALFTIME/FINAL chip** (lifted out of
   RunStatusControl — one chip, not the duplicate) + **role segmented control** (the 4 VIEW_PILLS as ONE control)
   + a far-right **ambient icon cluster**: Spotlight (Full/PA), Penalty+count (when `def.penaltyBox`),
   **Screens-health nub** ("●3 healthy / ⚠1" — SurfaceHealthPills collapsed to a summary, tap → full popover/
   drawer), Send-to-device (share icon → existing sheet). Single indigo accent; color only for live status.
2. **Status transitions fused to the board** — Go Live / Halftime / Final / Resume buttons move to a compact
   cluster at the scoreboard's top-right corner (not a strip). State-machine + cinematics/horn (T1-5) +
   hold-to-confirm (T1-3) + undo (T1-2) all UNCHANGED — only the mount point + chrome change.
3. **Scoreboard = the hero** (flex-1). ~160px reclaimed → `useConsoleFit` settles a looser tier (bigger clock).
4. **One presentation deck** (pinned bottom, regrouped by SPACING not competing borders): ribbon / roster /
   cues / sport-tray + Show Control scenes relocated here as a collapsible "Show on board ▸" section.
   **Back-to-Live hoisted to an always-visible deck-header slot** (red on-air / quiet "Live" when live) — never
   hidden behind a collapse.

**Why this over the two-column broadcast layout:** built INSIDE the existing `flex flex-col flex-1 min-h-0`
wrapper (page.tsx:1254) so the just-shipped `md:contents` mobile deck + `useConsoleFit` survive byte-identical.
A new desktop CSS-grid wrapper would risk the mobile deck (the operator runs from an iPhone). <2% regression.
Modern techniques: spatial grouping (Gestalt), progressive disclosure, single command surface, ambient status,
restrained single-accent palette, whitespace + type hierarchy, contextual chrome.

## OPERATOR DECISION (2026-06-22): "Go further — broadcast two-column desk"
Greg picked the more ambitious end-state over the single-column progressive-minimal: a **broadcast desk** —
thin command bar on top, then on desktop a **Game Control column (left, ~1.7fr: scoreboard + status corner +
sport tray)** and a **Presentation column (right, ~1fr: Show-on-board scenes, Celebrate/cues, Players, Ribbon)**.
**Phone stays the single full-bleed scrolling deck** (the `md:contents` wrapper dissolves the two-column grid on
mobile → one column). Approved mockup: the two-column broadcast-desk widget shown 2026-06-22 (concrete target).

Build order is unchanged through slice 2 (the command-bar + status consolidation is shared by both designs and
lowest-risk); the two-column split becomes the structural finale (was slice 6, now the goal). The grid MUST be
applied INSIDE the score/full region — NOT as a new top-level wrapper — so `md:contents` + `useConsoleFit` survive.

## Incremental slices (ship one at a time, verify on the pilot between each)
1. **Command bar** — collapse strips 1 (view/action) + 3 (screens health → nub). Biggest visible win, pure
   relocate. NEW `RunCommandBar.tsx`; `SurfaceHealthPills` gains a backward-compatible `summary` prop.
2. **Fuse status transitions to the board** — collapse strip 2; chip → command bar.
3. **Relocate Show Control into the deck + hoist Back-to-Live always-visible** — collapse strip 4. Most
   safety-sensitive: verify Back-to-Live is 1 tap (no expand) in Chrome+WebKit, desktop+phone.
4. **Deck polish** — collapsible Ribbon/Roster/Cues headers, single-accent pass, spacing-over-borders.
5. (deferred) ⌘K command palette over the T2-2 shortcuts.
6. (deferred, highest risk) desktop two-column game/presentation split INSIDE the scoreboard region only.

## Process
Build an HTML approval mockup FIRST (per CLAUDE.md design loop + the operator's "stop shipping layout blind").
Operator approves the shape → then rebuild slice-by-slice, each tsc + mobile-perf + adversarial review + CI-green
+ his eyes on the live console (authed console can't render under `next dev` — task #205).
