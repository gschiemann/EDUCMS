# Two-screen sync spec: the flake, the measurement, two player fixes - 2026-11-23

Branch `claude/sync-engage-measure`, cut from `origin/master` a884ada3b. Not pushed, no pull request yet; the Lead owns both.

Models: Claude Opus 5.5 built it, with workflow agents (an investigator and an independent skeptic, read-only). Fable 5.2 reviewed it, the same vendor, under the owner's written waiver ("Don't worry about another model review"). Round 1 verdict: approve, no must-fix; its should-fix items are handled below.

## Situation

`apps/web/tests/e2e/multiscreen-sync.spec.ts`, test "two screens lock, land on the shared epoch grid, and flip in lockstep (late joiner included)", failed its first attempt in **38 of 347** CI shard jobs between 2026-11-02 and 2026-11-23, on WebKit and Chromium. Every failure was the lockstep assertion. Every one passed on retry #1.

| Engine | First-attempt failures | Master | Pull requests |
|---|---|---|---|
| WebKit | 11 of 200 (5.5%) | 4 of 48 | 7 of 152 |
| Chromium | 27 of 147 (18.4%) | 4 of 33 | 23 of 114 |

Sixteen of the Chromium failures are a cluster at 47.6 to 51.3 ms (Nov 2 to 8). Chromium is undercounted: its shard 2/2 was cancelled in 54 of the last 160 runs. Source: a log scan of the last 300 CI runs and the blob reports still retained (7 days). The scratch data is CI-derived and untrusted; it stays out of the repository.

## Investigation 1 - why the test failed

**The spec compared the wrong two events.** B is the late joiner. Its first conductor tick after its clock locks snaps to the current slide mid-slot, by design (the engage snap). The spec chose its "steady-state" flips with a timing window, `serverT - itemStartT` in [-200, 250) ms. When B locked within about 250 ms after a boundary, that window let B's engage through, and the spec compared it with A's real crossing of the same boundary as if it were skew.

The failing attempt (job 137994671792, recovered from the blob report's step titles):
- The boundary was at ...612500. A decided at ...612483, a normal 17 ms lead.
- B's first locked tick came at ...612595, 95 ms after the boundary. It resolved slot 1 while B's counter was still 0, so it logged a one-step flip.
- B's lock wait resolved at ...612611, one frame after that flip, so B was not conducting when the boundary passed.
- The next three shared boundaries agreed within 1 ms each.
- So 112 ms = 612595 - 612483 was the join instant. It was not skew between two locked screens.

All four over-bound attempts still retained show the same thing: WebKit 112 and 205 ms, Chromium 166.1 and 200.5 ms. The skeptic re-parsed the blobs and could not refute it. It also ruled out the alternative (B locked in slot 0, then stalled across the boundary) from the order of the lock poll and the conductor, and from index logic.

**Two more defects in the measurement:**
- `itemStartT` was logged as `t + SYNC_FLIP_LEAD_MS - offset`, but the decision used `8 + renderLead`. So `itemStartT` was the boundary minus the render lead, and the "epoch grid" check measured the render lead. The CI values quoted in the spec when that tolerance went to 120 ms (64.3, 70.2 and 75.0 ms) were most likely stall-inflated leads.
- `serverT` is each page's own estimate of server time, so the spec could not see clock disagreement between screens.

**The Chromium cluster at about 50 ms** is attributed, for 14 of the 16, to a stall-inflated render lead on page A (55 to 70 ms against a usual 16 to 35 ms). The other two have A at the seeded 16 ms and are unexplained (a B-side lead or an admitted engage; B's values are gone). Why the cluster stopped after Nov 8 is unknown: no sync code changed in November.

**No rAF throttling of the unfocused page.** WebKit decision lateness was p95 15.3 ms (A) and 16.6 ms (B), both within one 60 Hz frame. Contention appears only while B boots.

## Investigation 2 - why our system tolerated it

1. **Retries turned a red into a pass.** `playwright.config.ts` sets `retries: 2` on CI, and `tests/e2e-shard-verdict.cjs` names a test that passed on retry as flaky, "visible, but not a failure". Thirty-eight first attempts failed and every check went green. Nothing counts flaky results across runs, so a 5 to 18% first-attempt failure rate had no owner.
2. **The E2E shards report; they do not gate.** "E2E Tests (Playwright / chromium|webkit)" are not among the nine required checks. Even a hard failure there would not have blocked a merge.
3. **The allowance was raised instead of the cause being found.** On 2026-08-04 one 57 ms WebKit sample took the WebKit CI bound from 40 to 90 ms, on the theory that both contexts share one renderer main thread. That theory was never tested, and the CI data shows no throttling. The grid tolerance went to 120 ms on the same day, on values that measured the render lead. Each widening made the next failure look like noise.
4. **The flip log could not tell an engage from a crossing.** With no `kind` field, a timing window was the only filter, and that window overlapped the lateness it was supposed to measure.
5. **The only product statement is "flips land within a frame across screens"** (`apps/web/src/app/player/CLAUDE.md`). The dashboard copy says "frame-locked" (for example `ScreenSettingsMenu.tsx`, "relative to its frame-locked group"). Neither has a bound behind it, so 90 ms of CI allowance never looked like a gap against a promise.

## What changed (four commits)

| Commit | What |
|---|---|
| b9f234ea6 `fix(player): sync flip log names the engage snap and stamps the paint` | Diagnostics only; nothing on the glass changes. The conductor keeps the previous locked tick of the active streak, reset whenever it stands down. Each `__eduSyncFlips` entry now has `kind` (`classifySyncFlip`, pure, in `sync/syncTimeline.ts`), `boundaryT` (the true slot start; `itemStartT` now equals it), `leadMs`, `prevT`, `wallT`, and `paintWallT` / `paintT` from the existing double-rAF. No new timers, no network, no manifest field. |
| 6c3821231 `fix(player): engage snaps stop feeding sync telemetry and the render lead` | Product gaps (a) and (b), below. New pure module `sync/renderLead.ts`, unit-tested in `sync/__tests__/renderLead.test.ts`; classifier tests in `sync/__tests__/syncTimeline.test.ts`. |
| e8d46ff10 `test(sync): measure lockstep on the paint, by crossing kind, with a join window` | The spec. Crossings are chosen by `kind === 'boundary'`. Lockstep is `|paintWallT_A - paintWallT_B|` for the same `boundaryT`. The grid check is replaced by epoch anchoring, `|paintWallT - boundaryT|`. The join window is asserted on its own bound. Per-boundary values are annotated on every run, before any assertion. |
| 3f2b87069 `test(sync): engage checked on the shared clock, A's join anchor, continuity` | Review round 1. Every engage is checked against the shared clock (decision plus lead inside the slot it resolved, 10 ms tolerance). A's join partner gets the join anchor check. B's crossings from the join on must be consecutive slots. The header now says what is annotated only and why. |

The bounds did not change: lockstep 40 ms (Chromium, and every local run), 90 ms (WebKit on CI); anchoring 120 ms on CI and 60 ms locally. New bounds: `JOIN_SKEW_BOUND_MS = 250` and `ENGAGE_CLOCK_TOLERANCE_MS = 10`.

### The join window bound

**`JOIN_SKEW_BOUND_MS = 250` is looser than the old spec was for that same flip** whenever the old spec happened to include it (40 or 90 ms). It is a separate, documented bound, as the task asked: B's first crossing after joining is where the one real near miss sat (88.5 ms WebKit decision skew, B deciding 83 ms late after a 181 ms post-engage stall). Folding it into the lockstep bound would fail on boot stalls, and dropping it would hide the worst real sample. The local worst over 29 runs was about 17 ms of paint skew. **Commitment: re-derive this bound from the `sync-join` annotations with the same ~20 CI runs per engine as the tightening plan below, and bring it down.**

### Negative controls (all fail as intended)

- B's clock answered 100 ms ahead: the new spec fails at 99.8 ms paint skew, and the old spec passed it twice (round 0).
- B's clock answered one slot ahead: the engage check fails at -1663 to -1913 ms into the slot (3 of 3).
- One of B's crossings relabelled `engage`: the continuity check fails (3 of 3).

## Product gaps and their fixes

**(a) A misleading dashboard number after boot.** A single-step engage was treated as a normal flip. It set `lastFlipErrMs` to its mid-slot offset (up to a whole slot, 10 s at the default duration) and seeded `flipErrEwmaMs` with it, which then decayed x0.7 per flip. That value is the render-proof `errMs` behind the "sync ±N ms" chip (`screenOps.ts` `syncStatusFor` -> `ScreenDetailDrawer`). After every boot the chip could show hundreds or thousands of ms, which breaks player rule 10 (copy claims only what the evidence proves). Now the flip-error update and the render-lead sample run for `kind === 'boundary'` only. Until the first boundary crossing the report says `errMs` null, as before any flip.

**(b) One stall could make a screen flip early.** The render-lead EWMA (alpha 0.2, samples accepted up to 400 ms, saved to localStorage every 10 s) moved by a fifth of one stalled sample. In CI a lead went from 16 to 65 ms across a post-boot stall. The samples were the engage's own decision-to-paint (about 197 ms) and then about 118 ms. That screen then decided its flips tens of ms early for about ten flips. Now a sample is capped at 2 x the current lead + one 60 Hz frame before it enters the EWMA:
- **Why not reject the sample:** rejection can lock a genuinely slow device out of calibration forever.
- **Why not a short median:** it has state to seed and reset, and two stalls in a row (what CI showed) get through a median of three.
- **What the cap costs:** it is stateless, and a slow device still climbs at least 1.2x per flip.
- **What it buys:** one stall moves the lead by at most 0.2 x (lead + one frame), about 10 ms at a 33 ms lead, instead of up to 73 ms.

The [0, 400] sample discard and the [0, 150] lead clamp are unchanged. **The on-glass effect of (b) on physical screens is unmeasured.**

Taurus: the player diff adds no `inset`, no flex `gap`, no four-side style object and no runtime API newer than `performance.timeOrigin` (Chrome 62, guarded). The build target is `Chrome >= 60`.

## The harness limit

Each page answers its own `TIME_PING` with its own `Date.now()` after a symmetric 2 to 6 ms delay, so clock-estimate error in this spec is about 1 to 3 ms by construction. Locally the error at the engage was -1.8 to -0.1 ms (37 engages over 29 runs). The spec catches regressions in the clock, lead and timeline math. **It cannot see Wi-Fi round-trip asymmetry between physical screens, which is the dominant source of skew on real glass.** A green run is not a claim about real screens.

## The on-glass check (`?synchud=1`)

This is the only evidence that counts for a fleet claim. Do it on bench screens, never on a customer's.

1. Put two bench screens in one playlist with Sync playback on and hard cuts (transition NONE), ideally side by side as on a video wall.
2. Open each screen's player with `?synchud=1`. Use a kiosk browser if the panel's start URL cannot carry the query. The HUD draws a sweep bar and a once-a-second flash, plus a readout: `clock` offset ± uncertainty, `rtt`, `skew` ppm, `slide`, `flip` (the flip-error EWMA), `lead` (render lead) and `trim`.
3. Film both screens in one shot at 120 fps or more. The sweep bar position and flash frame give the skew directly: one frame at 240 fps is about 4 ms.
4. Check fix (a): right after a reboot, `flip` must read `—` until the first boundary crossing, then a small number. It must never show hundreds of ms after boot.
5. Check fix (b): across the boot, `lead` should stay near its steady value (tens of ms). It should not jump to 60+ ms and decay over ten flips.
6. Repeat on Wi-Fi under load (another device streaming) to see round-trip asymmetry. Record the measured skew in `apps/player/HARDWARE-QUALIFICATION.md` or a handoff, with the hardware class.

## Tightening plan

1. Merge, then collect about **20 annotated CI runs per engine** of the new measurement. Read the annotations from the merged JSON report (`playwright-report-<browser>` artifact, 7-day retention) or the shard blob reports. The annotation types are `sync-boundary` (steady-state pairs), `sync-join`, `sync-engage`, `sync-a-before-join` and `sync-clock-basis`.
2. From that data, re-derive:
   - **`WEBKIT_CI_SKEW_BOUND_MS` (90) toward `SKEW_BOUND_MS` (40) for both engines.** Pre-fix steady-state decision skew, engage excluded, over 50 attempts: max 35.5 ms WebKit and 18.1 ms Chromium.
   - **`GRID_TOLERANCE_MS` (120 CI / 60 local).** Local anchors from the join on: max 24.1 ms.
   - **`JOIN_SKEW_BOUND_MS` (250).** Local join worst: about 17 ms paint skew, 19.2 ms anchor.
   - **`ENGAGE_CLOCK_TOLERANCE_MS` (10),** against the `sync-clock-basis` values on CI.
3. **Do not tighten to 40 ms before that data exists.** One reason it matters: on CI the anchor tolerance is 120 ms and the WebKit skew bound 90 ms, so a 100 ms clock error on one screen is caught on WebKit CI only by 10 ms of margin (the negative control failed at 99.8 ms). Tightening both closes that gap.
4. Then aim at the product's own statement, within a frame, on Chromium, only if the data supports it.

## Follow-ups for the Lead (not done here)

- `apps/web/src/app/player/CLAUDE.md`, sync rule 2, lists the pure modules as `syncClock.ts` and `syncTimeline.ts`. It should also list `sync/renderLead.ts`. This is a rulebook edit, so it is left to the Lead.
- **A hazard that was already there, not introduced here.** `advanceCounterTo` is forward-only. If the evaluation instant ever moved back across a boundary between two ticks (the lead dropping by more than a frame at a boundary), the counter would step `n - 1` slides forward. The cap does not make the lead fall faster, so the risk is unchanged. A unit test, plus a guard that treats a backward resolve as "hold", would close it. That is a player change for its own review.
- Something should count flaky-on-retry results across runs; today a test can fail its first attempt 18% of the time and stay green.
- The two unexplained ~49 ms Chromium values (Nov 2 to 8) need B-side data. The new annotations will carry it if the pattern recurs.

## Gates run on this branch (local, this sandbox)

All run on the final tree. The heavy ones ran one at a time under the machine lock (16 GB, 4 CPUs).

| Gate | Result |
|---|---|
| pnpm lockfile drift (`pnpm install --frozen-lockfile --lockfile-only`) | pass; the branch changes no lockfile or package.json |
| Web typecheck (`tsc --noEmit -p apps/web`) | pass |
| Web build (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`) + `check-bundle-budget.cjs` | pass; 2181 chunks, 20.14 MB, within the ceiling |
| Web jest, full suite (`--ci --maxWorkers=2`) | 723 suites, 10689 tests pass (the new `renderLead` and `syncTimeline` suites included) |
| `check-i18n-parity`, `check-mobile-perf` (`pnpm mobile-perf-guard`), `check-pill-rules` | pass |
| `check-inset-serialization`, `check-taurus-safety` and the other taurus-safety steps (scene-css, variant registry, board editability, widget truth, font ceilings) | pass |
| `check-rulebook` (+ self-test) | pass |
| `check-request-budget` (+ self-test) | pass; player timers 44/44 and 8/8, so no new periodic call |
| `multiscreen-sync.spec.ts`, Chromium, `--repeat-each=5`, one worker | 5 of 5 pass, twice (before and after the final comment edits) |
| emergency-path.yml Chromium list (5 specs) | 40 passed, 1 skipped. The skip is a `test.fixme` for Chromium already on master (`emergency-drill-paint-proof.spec.ts`, "a page reloaded under a persisted native hold..."), in a file this branch does not touch |

Local measurements over 29 Chromium runs (from the annotations; 24 before the final comment edits, 5 at the final spec):
- Steady-state paint skew: max 16.9 ms, a frame or less.
- Anchors from the join on: max 24.1 ms.
- Join paint skew: max 17 ms.
- Engage clock error: -1.8 to -0.1 ms (37 engages).
- Wall basis: -0.9 to 0 ms.

**Unverified:**
- WebKit was not run here; WebKit is CI's.
- CI has no runs of the new measurement yet.
- No physical screen was tested.
- The playwright browser here is Chromium headless shell 1243 through a scratch wrapper config, not the pinned 1217.

## Rollback

Revert the four commits, or any of them:
- The spec commits are independent of the player commits.
- The player commits change no manifest, schema or stored format. The render lead is still the same localStorage number, and the flip log only gains fields.
- Reverting 6c3821231 brings back the engage-seeded chip value and the uncapped EWMA.
