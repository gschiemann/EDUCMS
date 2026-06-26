# Sports Game-Control Console — UX/UI redesign (2026-06-16)

Senior-designer review + responsive mockups for every operator view. Mockups: `scratch/design/console/` (open `index.html`).

## Critique (current console)

The live game-control console is one 6,963-line monster page that does too much in too little vertical space, and it shows. The blunt problems, grounded in the real code:

1. SCROLLING IS THE DEFAULT, NOT THE EXCEPTION. The whole reason flex-1/min-h-0 fixes keep landing (see the long 2026-06-15 comment at L1390 about the scoreboard wrapper pushing roster/cues/tray off the bottom) is that the layout was never built fluid-first. It's a stack of fixed-height rows fighting over leftover space. On a MacBook at 1440x900 the operator still scrolls mid-game — the cardinal sin for a live console where the next play happens in 4 seconds.

2. FOUR STACKED CHROME ROWS EAT THE VIEWPORT. Top toolbar (back + Run/Setup tabs + Ribbon/Scoreboard/Stream/Keys buttons, L491), then the SurfaceHealthPills row, then the view-switcher + action-rail row (L1185), then the actual board. That's ~150px of chrome before any score control. The operator literally asked to "remove another line so the screen can come up more" (L483) — the redesign must collapse chrome into ONE command bar.

3. NOT RESPONSIVE — IT'S DESKTOP-WITH-BREAKAGE. The board uses Tailwind grid-cols that don't reflow into a sane tablet shape; on iPad the action rail overflow-x-auto's into a hidden-scroll mess. There's no single fluid shell. v6 proves the fix (100dvh flex + grid-areas that reflow at 920/560) but the production page predates it.

4. DATED, FLAT, GENERIC. Indigo pills on slate-50, 11px uppercase labels, rounded rectangles with shadows. It reads like an internal admin tool, not a $$$ broadcast control surface a venue paid for. No depth on the board, no broadcast-grade typography, no visual hierarchy between "the score" (huge) and "sponsor flight dates" (tiny). A superintendent or AD would not show this to their board.

5. TAP TARGETS ARE INCONSISTENT. Some buttons are min-h-[44px] (good, recent fix), but steppers, number chips, the +/-1s clock nudges, and the segment chips vary from 30px to 44px. On a wet-fingered volunteer's iPad at the scorer's table, 30px is a misfire waiting to happen. There's no single coarse-pointer contract.

6. CONFIG AND LIVE-OPS ARE TANGLED. Setup mode crams six heavy Sections (Game basics, Teams+roster, Pregame intro, Displays+layouts, Ribbon×3 panels, Sponsors×2 panels, Show settings) into one scrolling column — pre-game work fine — but Run mode also surfaces Presentation/Spotlight as popups, so the operator never knows whether a thing is "live now" or "set it and forget it."

7. CONSISTENCY IS ACCIDENTAL. Every sub-panel re-invents its own button, chip, stepper, and label styles inline. There is no shared design system, so the PA view, the penalty box, the cue bar, and the scoreboard look like four different products bolted together.

## Principles

- ZERO-SCROLL DURING PLAY. The live surface is a 100dvh flex column: one command bar (fixed), the board (flex-1, claims all leftover height), and pinned action rows at the bottom. Only the board area may scroll, and only if it truly cannot fit. Nothing the operator needs in the next 4 seconds is ever below the fold.
- ONE COMMAND BAR, NOT FOUR. Collapse back-link, Run/Setup, view-role switcher, Outputs toggles (Scoreboard/Ribbon/Stream), surface-health dots, and Keys into a single chrome strip. Reclaim ~100px of vertical the operator explicitly asked for.
- FLUID BY CONSTRUCTION, NOT BY PATCH. Every size is clamp()/%, every layout is CSS grid-areas that reflow at named breakpoints (>=1200 monitor, 920 tablet, 560 phone). The same markup serves the press-box monitor, the AD's MacBook, and the volunteer's iPad — no separate mobile build.
- DARK BOARD, LIGHT CHROME. The scoreboard/clock/score live on a dark broadcast-grade surface (gradient depth, tabular-nums, oversized score) so the eye locks onto the game state; all controls/config sit on light chrome. The visual split itself communicates 'this is the show vs. this is the desk.'
- BROADCAST TYPOGRAPHY HIERARCHY. Score is the single biggest thing on screen (clamp to ~9-11vh). Clock second. Stats/steppers tertiary. Config (sponsor flights, frequency caps) smallest. Size encodes urgency.
- COARSE-POINTER FIRST. Every interactive target is >=44px (>=46px under pointer:coarse) via one token. Steppers, number chips, clock nudges, segment chips — no exceptions. A wet finger on an iPad must not misfire onto Reset when it meant Stop.
- DESTRUCTIVE = HOLD-TO-CONFIRM, EVERYWHERE. Mark Final, reset clock, advance segment use the same press-and-hold ring as the panic page. The interaction is consistent so muscle memory transfers between actions.
- EVERY CUE KNOWS ITS TARGET. The All / Board / Ribbon send-to chip is a first-class, always-visible control on every cue/celebration surface — the operator never fires blind to all screens by accident.
- MULTI-OPERATOR IS A FEATURE, NOT A SETTING. Role views (Scorekeeper / Show Caller / PA) are one tap to switch and one tap to hand off (QR + copy-link). The console scales from one person to a four-person crew without leaving the page.
- ONE SHARED DESIGN SYSTEM, INLINED VERBATIM. Tokens, command-bar, dark board, buttons, steppers, chips, and breakpoints come from a single CSS contract every screen pastes identically — so the scorekeeper view, the penalty box, and the meet-results grid are unmistakably the same product.
- LIVE STATE IS ALWAYS VISIBLE & HONEST. Per-surface health (Scoreboard/Ribbon/Stream online?), clock-running pulse, 'on air' spotlight, and 'in the box' counts are persistent affordances — the operator never wonders whether a screen is actually receiving.
- CONFIG vs LIVE IS SPATIALLY SEPARATED. Run mode = only things you touch during play. Set up = everything you do before the whistle. No live control hides in a config popup; no config clutters the live board.

## Screens mocked

- **Full Run (single operator)** (`run-full.html`) — The default live console for a one-person crew running everything — score, clock, cues, roster — from one pane of glass during play.
- **Scorekeeper** (`scorekeeper.html`) — The person at the table whose only job is score + clock. Hands them a tablet that can't accidentally fire a cue or crash the board.
- **Show Caller** (`show-caller.html`) — Second tablet at the table (or dedicated show-caller) who drives the presentation — fires celebrations, replays, sponsor reads — while watching the live surfaces. Cannot change the score.
- **PA / Announcer** (`pa-announcer.html`) — The booth announcer on their own phone. One job: spotlight the player they're about to call. No score, clock, or cue access.
- **Cue Launchpad** (`cue-launchpad.html`) — The full celebration/cue board the operator pops open mid-game (or that lives always-on in Show Caller) to fire the right moment to the right surface.
- **Spotlight Builder** (`spotlight.html`) — Put a specific player or custom promo on the scoreboard AND ribbon — the sponsor-activation / player-of-the-game moment ADs sell.
- **Exclusions / Penalty Box** (`penalty-box.html`) — Manage time-serving players for penalty-box sports (water polo exclusions, hockey/lacrosse penalties) — send to box, watch live countdowns, release early on a power-play goal.
- **Set up — Game basics, Teams & Roster, Sport** (`setup.html`) — Pre-whistle configuration done before the crew goes live: set game state, build rosters, confirm teams/sport, fire pregame intros.
- **Starting-Lineup Intro** (`starting-lineup.html`) — The pregame choreography that takes over the scoreboard with per-player slots (photo + name + cap + stats), fired team-by-team during introductions.
- **Meet Results / Leaderboard** (`meet-results.html`) — For leaderboard + judged sports (track, swim, cross-country, golf, gymnastics, cheer) where finish order or judged marks ARE the scoreboard — record places and marks that drive the board.
- **Presentation & Show Settings** (`presentation-settings.html`) — Pre-game rehearsal + show configuration: celebration pack, celebration sound, co-brand sponsor, test-fire cues, shot-clock setup, CTS console status.
- **Sponsor Management & Scheduling** (`sponsor-scheduling.html`) — The revenue surface: manage sponsor brands/logos and schedule their rotation — flight windows, weights, frequency caps, proof-of-play.
- **Screens & Layouts (Send to device)** (`screens-layouts.html`) — Assign what each physical display shows and which template drives each surface — plus the live previews to confirm before kickoff.

Source workflow: wf_d729879b-4bf.
