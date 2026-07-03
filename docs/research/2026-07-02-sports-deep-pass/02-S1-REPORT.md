# Sports Wave S1 — builder report (compact, 2026-07-02)

Branch worktree-agent-a5411e2ee2a0ec61e, 4 commits, 400 tests green (275 api
+ 125 web), tsc clean both apps, mobile-perf clean, fence respected (9 files).

- S1-1 0919c7a9 optimistic score/clock/segment/stats (onMutate+rollback,
  mirrors screens-hooks; clock re-anchor math matches useLiveClock; segment
  conservative — writeBack reconciles). 16 new tests.
- S1-2/3 3156c5ea lane pad: ~800ms debounced provisional publish under the
  SAME event label nextHeat uses (mergeHeatResult dedup supersedes it — no
  schema change; sanitizeResults strips unknown keys so a provisional flag
  was never viable); undo restores rows + results. 5 new tests.
- S1-4 27fa3e1e meet-results draft inputs (commit-on-blur/Enter) for the 5
  per-keystroke fields + min-h-44px. 10 new tests.
- S1-5 f8fd99d0 POST /sports/games/:id/end-segment — all four EndSetMacro
  effects in ONE $transaction (first in sports.service). Client falls back to
  legacy 4-mutation path on 404 only. 7 tests incl. two real rollback tests.

OUT-OF-SCOPE ROOT CAUSE (found, not fixed — file follow-up): live pre-S1-5
EndSetMacro likely DOUBLE-CREDITS sets on volleyball/pickleball — setSegment's
isSetGameSport advancing branch (sports.service.ts ~2377-2416) already credits
set+zeroes scores, and the macro's 4 near-simultaneous .mutate() calls let
setSegment see the just-applied stats credit. S1-5's atomic endpoint sidesteps
it (self-contained, no setSegment call); legacy fallback path still exposed.

Unverified: no live click-through (auth+live-game impractical in worktree);
behavior proven via real-hook/component mounts, not shallow mocks.
