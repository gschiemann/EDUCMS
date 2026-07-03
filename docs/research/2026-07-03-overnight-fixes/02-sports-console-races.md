# Sports console race hardening — #292 + #294 (2026-07-03)

From the overnight regression review.

**#292 [P1] lane-pad provisional-vs-finalize PATCH race.** 800ms debounced provisional
stats PATCH could land AFTER nextHeat()'s finalize (whole-array replace), clobbering the
finalized heat's marks. Fix (client-only, LanePadSection.tsx): `pendingProvisional` ref
captures the debounce-fired `ctl.stats.mutateAsync(...).catch(()=>{})` promise;
`drainProvisional()` = cancelProvisionalTimer() THEN await that promise. nextHeat() and
undoLastSave() `await drainProvisional()` as their first line — the finalize/undo request
is physically impossible to send before the provisional's has reached the server.
nextHeat() also re-baselines its merge from `qc.getQueryData(['sports-game',gameId])`
(the server-confirmed cache) instead of the stale `stats` prop. Commit eba2adc0.

**#294 [P2] meet-results rapid-tab stale closure.** MeetResultsSection.write() closed
over the render-time `events`; two fast Tab-commits both computed from the same stale
snapshot, second dropped the first's edit. Fix: write() now reads the LATEST results from
`qc.getQueryData(['sports-game',gameId])` at commit time (new gameId prop; falls back to
prop-derived events if absent). Extracted parseResultEvents to run against both. Commit
56d2d221.

Both tests VERIFIED to fail pre-fix / pass post-fix (git-stash proof). Checks: web tsc
clean, jest LanePadSection+MeetResults 27 tests, full [gameId] dir 104 tests, mobile-perf
clean. Fence-clean (2 files + their existing test files). Re-gated by lead before merge.
