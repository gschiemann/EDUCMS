# Sports Section — Default-Surface Parity Audit (quick, lead-authored)

Date: 2026-07-01 (Fable). Trigger: Greg keeps catching "major misses" —
no lanes for swimming (#267), generic default scoreboards. Question: is the
DEFAULT experience per sport actually that sport, and is scorekeeping UX
world-class?

## The systemic root cause (the class of bug, not the instances)

**Features ship to the BUILDER but the DEFAULT surfaces lag — and nothing
gates it.** #267 was exactly this: lane-grid widget built, registered,
tested… and the Game-Day board never used it. There is no per-sport parity
check, so the only detector is Greg's eyeballs. Every gap below is this same
class.

## Coverage map (grep of per-sport branches, def.key/sport ===)

| Surface | Dedicated treatment | Generic fallback |
|---|---|---|
| **Board** | football (down/distance), water polo (exclusions/shot), basketball, baseball line-score (stats-driven), swim/dive (as of cfffcbf8); leaderboard sports get context labels only | track/XC/golf/gym/cheer = one shared LeaderboardScene w/ label swaps |
| **Ribbon** | 9 head-to-head sports have situation tiles | ALL meet sports (swim/dive/track/XC/golf/gym/cheer) — no meet tiles (current event/heat/leader) |
| **Scorebug** | leaderboard context line only (golf/gym/dive/XC/cheer) | swimming has NO scorebug branch — the research's SWIM_SCOREBUG (big running clock + leader strip) was deferred and never surfaced |
| **Console** | basketball/football/gym/diving/water-polo/swim have branches | meet scorekeeping = MeetResultsSection: hand-typed place/name/lane/mark rows |

## Findings, ranked

1. **P0 — No parity gate (the fix for the CLASS).** Add a per-sport
   default-surface Jest render test: for each of the 18 sports, render the
   board scene LIVE with sample stats and assert a sport-specific marker
   (swimming→lane rows, baseball→R-H-E, football→DOWN & TO GO, diving→DD,
   water polo→exclusions…). Runs in CI like taurus-safety. Turns "Greg
   catches it on screen" into "CI blocks the merge." Without this, every
   future sport widget repeats #267.

2. **P1 — Track & Field is the same miss as swimming was.** The swim
   research (Part C) explicitly says the lane grid generalizes to track
   running events "for free" (lanes × athlete/time/place, LANE⇄PLACE) — we
   never did it. Track today = generic points tally. Same for field events
   (attempt-leaderboard ≈ the dive leaderboard, also for free).

3. **P1 — Meet sports have NO ribbon presence.** A swim/track meet's ribbon
   shows generic score only — no "EVENT 12 · HEAT 3 OF 4 · leader" tile.
   The head-to-head sports all got situation tiles; meets got skipped.

4. **P1 — Swim scorebug missing.** Research A8 spec'd SWIM_SCOREBUG
   (running clock + leader strip for streams); deferred in the depth pass
   and not tracked anywhere until now.

5. **P1 — Scorekeeping UX for meets is a form, not a console.** Live swim
   meet entry = typing free-text rows in MeetResultsSection. World-class is
   a **lane pad**: 8 pre-filled lane rows (from roster), tap lane → type
   time → auto-place computed by sorting marks; heat advance button.
   (Head-to-head console UX is genuinely good — steppers/undo/shortcuts;
   the gap is meets specifically.) CTS auto-ingest (parser shipped,
   #263 hardware bridge) is the real endgame; the lane pad is the manual
   fallback every meet needs anyway.

6. **P2 — Leaderboard sports share one visual shell.** Golf (hole-by-hole),
   gymnastics (per-apparatus), cheer (judged panels) each get label swaps on
   the same scene, not sport-authentic boards. Lower priority than 2-5 —
   the shell is at least coherent — but "world-class" per sport it is not.
   (Overlaps existing #255 design-mockup workstream.)

## Order of attack
#1 parity gate FIRST (locks the class, makes gaps enumerable in CI) →
#2 track lanes (reuse SWIM_LANE_GRID, cheap) → #5 lane-pad console UX →
#3 meet ribbon tiles → #4 swim scorebug → #6 per-sport visual depth.
