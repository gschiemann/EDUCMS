# Three E2E reds on master: one product log, one stale test, one rendition budget (2026-11-23)

**Status.** Branch `claude/e2e-master-fixes`, cut from `origin/master` `1006d21b2`. One commit per fix, each with its own section below: `c4fa907f2` (item 1), `0c4241304` (item 2), `ce6bcafce` (item 3), then the commit that adds the final gates and the owner's checks to this file. Not pushed, no pull request. `master` has since moved to `31ebf86e7` (#350, #351); `git merge-tree` against it is clean and no file is changed on both sides, but the gates below ran on this branch's own head, so CI on the updated branch is the gate that counts. The owner's written go: "merge and finish everything". None of the three touches the emergency path. Item 1 changes the web player's console output, so it reaches every screen with its next bundle update. Item 3 changes how the STREAMING widget picks its hls.js rendition; that widget is unmounted by an alert takeover. Item 2 is test-only.

**How the causes were found.** A read-only investigation per item, each checked by an independent skeptic who tried to refute it. Where the skeptic corrected the finding, the correction is what shipped and what is written here. AGENTS.md asks for two investigations per failure, so each item says why the product (or the test) failed and why our system let it reach `master`.

**The common answer to "why did our system let it through".** The general E2E shards (`E2E shard (Playwright / chromium N/2)`, `webkit N/4`) are not among the nine required checks (CLAUDE.md §10). Release trains merged them red, and the PR bodies said the train's own CI was the proof. Whether to require them is the owner's decision; it is not changed here.

**WebKit.** WebKit is not installed in this sandbox. Every WebKit claim below is unverified locally and CI is its gate. To get close, the local runs add a scratch Playwright project, `chromium-dsf2`: Desktop Chrome at deviceScaleFactor 2, the scale of Playwright's "Desktop Safari". Items 2 and 3 both fail in WebKit because of that scale.

## 1. `player-bad-file`: one `PLAYLIST_FALLBACK` line per change

**The failing assertion.** `apps/web/tests/e2e/player-bad-file.spec.ts`, the incident test ("the card stays for two minutes, then the other playlist takes the screen"): `expect(lines).toHaveLength(1)` received two lines, on every attempt, in both browsers:
- `[Player] PLAYLIST_FALLBACK nothing in "4k" can be shown on this screen — showing "Everyday" instead; …` (the selection's decision line, applyManifest);
- `[Player] PLAYLIST_FALLBACK episode backup: scheduled pl-4k, backup pl-everyday` (the episode, `advanceFallbackEpisode`), 66 ms later in the CI trace.

**Why the product failed.** One fallback was logged twice, from two places. Nothing was applied twice: the second line came from a deterministic state change (the episode goes from nothing to `backup` once the backup is proven on the glass), not from a race. 7ae615d7f (2026-11-13) added the decision line, deduplicated by its text, and wrote rule 20's "one `PLAYLIST_FALLBACK` line per change". 7f36cf0ae (2026-11-14, PR #315) added the episode line with the same token. That commit rewrote the test but kept its "Said once" assertion, and 69fc59b3f restated the rule four seconds later. The test was right and the product broke it. Impact: console and diagnostics only. The telemetry block, the audit rows, the bell, the dwell, the set-aside ledger and the recovery proof were never involved.

**Why our system let it reach master.** PR #315's own head 69fc59b3f was already red on this exact assertion (webkit 3/4 job 132547031790; its chromium 2/2 was cancelled). Release train #329 carried it into `master` on 2026-11-16 with E2E red; its body said "CI on this PR is the proof for the rest". **First red master commit: d6b113aaa** (the #329 merge; chromium 2/2 job 133438026992, webkit 3/4 job 133438026892). It is also the first master commit that has the fallback tests at all: 94644f9e7's spec has none, so this test never had a green baseline on master. Every later master commit is red the same way: 4ae746ca, 9bcf6bab, 4fb09095, dce30cd5, 3182f1fa, e20c3b8a, 1292fd287, 8eb336396 (jobs 137968416510 and 137968416437) and 88b37a59b (jobs 137975706311 and 137975706234).

**The fix.** Each change is said by exactly one of the two places (`apps/web/src/app/player/playlistFallback.ts`, pure):
- `fallbackDecisionLog(fellBack, primary, winner)` builds the decision line, with its text unchanged. It returns the key the page deduplicates by: both playlist ids **and** the text. Today's key is the text alone, so after the episode line was dropped, a move between two backups with the same display name would have printed nothing (skeptic amendment).
- `fallbackEpisodeLogLine(prev, next)` returns null on entry to `backup` (the first time, again after a failed retry, a move to another backup, a new episode), when nothing the line names changed, and when there is no episode. It keeps the existing text for `retrying` and `recovered`, which the decision line cannot know.
- `page.tsx` calls both helpers in place of the two inline emitters.

Not changed: the `PLAYLIST_FALLBACK` token (renaming or recasing it would only hide the line from operators), the decision line's words, `nextFallbackEpisode`, the episode storage, the telemetry block, the dwell, the ledger, the recovery proof, the emergency gates and the kill switch. Rule 20 in `apps/web/src/app/player/CLAUDE.md` gains the clause that says how the one line per change is kept, and `CHANGELOG.md` gains the entry.

**Tests.**
- Unit, `apps/web/src/app/player/__tests__/playlistFallback.test.ts`: 12 new cases, one per transition. Entry to backup in each of its four forms, retrying, recovered (from `retrying`, and straight from `backup`), no change, no episode, the decision line's text and name fallbacks, the empty key off a fallback, the id+text key (two backups with one name are two changes). Plus two replays of both emitters over the incident sequence and over a same-name backup move. The incident replay asserts exactly `[decision, retrying, decision, retrying, recovered]`.
- E2E, tightened: the incident test now also asserts the count is still 1 after the report window. The "first choice is fixed" test now collects the console too and asserts exactly three lines, in order: the decision line, `episode retrying`, `episode recovered`. Before, CI could not see those two lines: the test collected no console output, and a first-attempt pass leaves no trace.
- **Negative control** (a scratch build with the old emitter rule put back, never committed): the incident test fails with `Received length: 2`, the same two lines as CI. The "fixed" test fails with 4 lines (the extra one is `episode backup`).

## 2. `website-tabs` in WebKit: the test asserted the 2026-11-07 corner bug

**The failing assertion.** `apps/web/tests/e2e/website-tabs.spec.ts`, "posts webTabsShow with bounds + allowlist to the APK": `expect(last.bounds.width).toBeGreaterThan(1000 * dpr)`. In WebKit: Expected > 2000, Received 1920, on all three attempts (master 8eb336396, webkit 4/4 job 137968416400). Chromium passes the same test.

**Why the test failed (the product did not).** 700d93b82 (2026-11-07) fixed a field bug on a 4K Goodview panel: the native site view landed in a corner, three times too far down and right. The widget stopped multiplying its CSS rect by `window.devicePixelRatio` and now uses `cssToWindowRatio`, the APK's `w`/`h` over `innerWidth`/`innerHeight`. That ratio is 1 under the player's pinned viewport, whatever density the ROM reports. The unit contract pins this. That commit touched no e2e file, so the spec still scaled its thresholds by `devicePixelRatio`. Desktop Safari runs at deviceScaleFactor 2 and Desktop Chrome at 1, so only WebKit noticed. On the same CSS rect:

| | old dpr math `{0,192,3840,1968}` (the corner bug) | fixed math `{0,96,1920,984}` (what ships) |
|---|---|---|
| OLD assertions (top > 80, width > 2000, height > 1000, bottom ≤ 2161) | all pass | width and height fail |
| NEW assertions (left ≥ 0, top > 40, width > 1000, height > 500, right ≤ 1921, bottom ≤ 1081, exact rect) | right edge (3840 > 1921), bottom (2160 > 1081) and the exact rect fail | all pass |

So in WebKit the old test was green on the corner bug and red on the fix. No Safari visitor is affected: the native path needs the APK's channel, and real browsers take the iframe fallback, which passes in WebKit.

**Why our system let it reach master.** 700d93b82's own CI run was already red on this assertion (webkit 4/4 job 128547266936, 2026-11-07T23:08Z). Release train #263 merged it with its head's webkit 4/4 cancelled (job 128609639466). The next three master runs, 9961ecbbf (the #263 merge, where the cause entered master), 887dff130 and 0fdbf4940, were cancelled before they reached the spec. **First completed red master commit: 1955275ac** (the #266 merge, 2026-11-08, job 128753104363). The last green was 78e97aa1c (job 128607975557). It stayed red on every completed webkit 4/4 run after that.

**The fix (test only).** A `PANEL = { w: 1920, h: 1080 }` constant drives both the goto URL and the assertions. The lower bounds use `ratio = PANEL.w / innerWidth`. That ratio copies the product's own formula and is 1 in both projects, so it adds no coverage by itself (skeptic). Two containment lines are the regression guard: right edge ≤ `PANEL.w + 1` and bottom ≤ `PANEL.h + 1`. A mandatory `expect.poll` requires the last posted bounds to equal the `website-tabs-content` box scaled by that ratio and rounded edge by edge as `toNativeBounds` rounds. That is the only check that catches a mis-scaled rect that still fits on the panel (for example a ratio of 0.9 gives a width of 1728). It is polled because the widget's settle burst (16 ms to 2.5 s) may post a later show. No product change.

**Tests (local).**
- New spec, Chromium: the whole file passes 4/4. The run needs `E2E_BASE` set to the port it serves on, because the builder test's CORS origin comes from it. My first run on a custom port without it failed the builder test with "Can't reach the server": a harness mistake, not a product or spec failure.
- New spec, `chromium-dsf2` (the Desktop Safari scale): the native test passes.
- Master's spec, `chromium-dsf2`, against the fixed product: fails `Expected: > 2000, Received: 1920`, exactly CI WebKit's failure, reproduced without WebKit.
- **Negative control** (a scratch build with `measureBounds` back on `devicePixelRatio`, never committed): the new spec at `chromium-dsf2` fails at `right edge on the panel: Expected <= 1921, Received 3840`. Master's spec passes on that build, which shows the old test was green on the bug. At dpr 1 (`chromium`) the new spec cannot tell the two maths apart. Only the dsf-2 project, which is WebKit on CI, can.
- Not run in WebKit: the lines after the bounds (tap Google, re-show with the new URL, no blocked card) have not run in WebKit since 700d93b82, because every run stopped at the bounds. If CI WebKit fails there, treat it as a new finding.

## 3. `streaming-widget` in WebKit: the rendition budget ignored what a pixel is

**The failing assertion.** `apps/web/tests/e2e/streaming-widget.spec.ts`, "two streams on one board both play": `stream 0 frames advanced (1 → 1)`, where stream 0 is the Mux VOD. It failed on all 3 attempts on PR #345 (job 137470626547) and on master 1292fd287 (job 137419519314). About 90% of WebKit attempts fail. 8eb336396 passed on its first attempt, with no code change.

**Why the product failed (the mechanism as corrected by the skeptic).**
- **The engine.** CI's Playwright WebKit is a WPE build without native HLS, so `LiveVideoStream` runs hls.js over MSE there. The "Desktop Safari" project runs at devicePixelRatio 2.
- **The cap.** hls.js 1.6.16's `capLevelToPlayerSize` multiplies the zone's size by devicePixelRatio. A 640×720 CSS half-zone was treated as 1280×1440, so both streams were allowed their 1080p renditions.
- **What the trace shows.** Mux played segment 0 at 720p. Within about 0.3 s hls.js switched both streams up to 1080p, about 33 MB of appends for Mux. Bipbop never showed its 1080p (gear5) data: hls.js reloaded it at gear4, and it kept playing. Mux stopped presenting frames inside its **720p** segment 0 (0.22 to 3.5 s of content), before any 1080p frame was due, and hls.js raised no fatal error.
- **So it is not a 1080p60 decode cost.** The trigger is the early up-switch to a 1080p rendition in WPE's MSE path, possibly with the size of the append burst. The exact internal failure is unproven: non-fatal hls.js errors and level switches were never recorded. They are now.
- **The defect is real beyond CI.** On the APK, one CSS px is one physical px (the player pins its viewport to the panel's pixels and loads at `setInitialScale(100)`), while the ROM reports a density of 2 to 3. hls.js was multiplying by a number that means nothing there, and a half-screen zone could fetch and decode 1080p. That broke the component's own promise.

**Why our system let it reach master.**
- f3f73d319 (2026-11-07) added the component and this spec together. It reached master through release train #263 (merge 9961ecbbf), whose WebKit shard was cancelled.
- **First red master commit: 0fdbf4940**, the first master run that executed the test in WebKit (job 128637273844). All 3 attempts failed.
- The spec was merged on a local "12/12 passed, Chromium and WebKit". That was most likely on macOS, where Playwright's WebKit has native HLS and never takes this path (unverified). The streaming handoff said "Not verified: CI".
- E2E is not a required check, and the occasional green (c27a720, 8eb336396) made a broken test look flaky.

**The fix.**
- **Product** (`apps/web/src/components/widgets/streaming/LiveVideoStream.tsx`): `ignoreDevicePixelRatio: true` in `new Hls({...})`, so `capLevelToPlayerSize` caps by the zone's CSS size, as the component promises. The skeptic ruled out `maxDevicePixelRatio: 1`, which is min(dpr, 1) and under-caps a ROM that reports 0.75.
- **Diagnostics** in the existing `window.__eduStreams` proof, written only by the existing once-a-second watchdog tick (no new timer, no network):
  - `currentTime` and `readyState`;
  - `getVideoPlaybackQuality` dropped/total;
  - the playing, loading and cap renditions (width, height, fps, bitrate), and the rendition list;
  - the last five NON-fatal hls.js errors and level switches. Non-fatal errors still return early as before; they are now also recorded.
  - Each video carries `data-stream-proof-id` so a test can find its own proof.
- **Spec:**
  - The frame-advance assertion and its 3 s window are unchanged. Its message now carries each stream's proof.
  - New assertion: in each half-screen zone, the rendition playing, the one being fetched and hls.js's own cap are at or below the CSS-size cap. That cap is computed in the test from the zone's CSS box and the rendition list, never multiplied by devicePixelRatio. Under the browser's native HLS, hls.js is not in play, so the test records an annotation instead.
  - The proofs are attached to the run (`stream-proofs.json`, in the HTML report on CI).

**What changes for whom.**
- **APK panels** get a correct, physical-pixel cap. The over-fetch caused by the inflated ROM density is gone.
- **Real hi-DPI browsers** (a Retina admin preview, a browser player on a hi-DPI display) now get renditions sized to the zone's CSS pixels, softer than their pixels could show. A full-screen 1920×1080 CSS zone still gets 1080p.
- **The editor's "Test stream" pill** reports the decoded width × height. On a Retina Mac it now shows the preview's rendition (for a 1080p source in the small preview box, e.g. 640×360 or 848×480), not the source's best. Its copy is unchanged. Whether to word it as "the preview rendition", or to keep the device pixel ratio for the editor's instance only, is the owner's call. `/player` must keep the new cap either way, because that is what the spec runs.

**Tests (local, Chromium; WebKit is CI's).**
- The whole spec, `chromium`: 6/6 passed, none skipped (the third-party streams were reachable).
- Two streams, `chromium-dsf2` (the Desktop Safari scale): passed. The attached proofs at dsf 2 show Mux playing, fetching and capped at 848×480 (zone 640×720), and bipbop playing 640×360 under a 960×540 cap. Bipbop also logged three non-fatal `fragParsingError`s at start in both projects. These are the first data from the new diagnostics; hls.js recovered and they were not investigated.
- **Negative control** (a scratch build without `ignoreDevicePixelRatio`, never committed), `chromium-dsf2`: fails at "the rendition playing is within the cap". The proof shows Mux playing 1280×720 and fetching 1920×1080 under a 1920×1080 cap in a 640×720 zone: the same early up-switch the WebKit trace shows, reproduced in Chromium. Chromium kept advancing frames through it, so the freeze itself is WPE's. At dpr 1 (`chromium`) the old config passes, because dpr 1 cannot tell the two apart.

**Not verified, and the follow-up.**
- That the change turns CI WebKit green. Pass means 5/5 first-attempt passes of the webkit 4/4 two-streams test; at today's roughly 10% first-attempt rate, 5/5 by chance is about 1e-5.
- If CI WebKit still freezes, read the per-stream proof in the failure message first (playhead stopped or frames dropped, which rendition, which non-fatal errors). Bipbop still switches up under the fix (gear1 to gear3); check its switches before blaming Mux.
- The skeptic's discriminating experiment: in a diagnostic branch, never the product, cap Mux at its 720p start level so it plays with no switch.
- If WebKit still freezes after that, the honest follow-up is a macOS-runner job that runs this spec's WebKit leg on the engine Safari users actually have (native HLS). That is a CI-definition change and needs the owner's approval; it is not done here. The Linux leg stays, with no skip.
- On glass: that a half-screen stream on a bench APK screen picks the CSS-size rendition (expected: the physical-pixel size, since 1 CSS px = 1 physical px there).

**Mount proof.** `LiveVideoStream.tsx` is reachable from the `/player` route through the module graph: `app/player/page.tsx → lazyRenderer.ts → rendererBundle.tsx → WidgetRenderer.tsx → widget-families.tsx → StreamingWidget.tsx → LiveVideoStream.tsx`. That is a TypeScript `preProcessFile` walk over static and dynamic imports. Its negative control: `BuilderShell.tsx` and `BottomToolbar.tsx` come back unreachable from `/player`. The e2e also proves the mount in the rendered DOM: the player route's videos carry the new `data-stream-proof-id`.

## Tests run for this branch (all local, Chromium; exact results)

| What | Result |
|---|---|
| `jest src/app/player/__tests__/playlistFallback.test.ts` | 62/62 passed |
| `jest src/app/player stream-source.test.ts website-tabs-config.test.ts --maxWorkers=2` | 137 suites, 2132 tests passed |
| `tsc --noEmit` (whole web app, e2e specs included) | clean |
| `check-rulebook.cjs` | PASS |
| `check-taurus-safety.cjs`, `check-inset-serialization.cjs`, `check-request-budget.cjs` | OK |
| eslint on the changed files | no new findings against `master` (the pre-existing `no-explicit-any` counts are unchanged) |
| `player-bad-file.spec.ts`, chromium, `--retries=0` | 7/7 passed |
| `website-tabs.spec.ts`, chromium, `--retries=0` | 4/4 passed; native test also passed at chromium-dsf2 |
| `streaming-widget.spec.ts`, chromium, `--retries=0` | 6/6 passed; two-streams also passed at chromium-dsf2 |
| Negative controls (scratch build with the three old behaviours) | player-bad-file: 2 fallback tests fail as CI does; website-tabs dsf2: right edge 3840 > 1921; streaming dsf2: playing 720 > cap 480 |

After the negative control, the fixed tree was restored (its diff checked byte for byte against the one saved before), rebuilt and run once more: the three specs in `chromium`, 17/17 passed, plus the two DPR tests in `chromium-dsf2`, 2/2 passed, all with `--retries=0`. The e2e runs used a scratch config, kept outside the worktree and never committed, that points Chromium at the preinstalled headless shell 1243.

One process slip, reported by the author: one of the whole-app `tsc --noEmit` runs above was started outside the machine's lock wrapper for heavy commands. Nothing crashed, but on this 16 GB machine that rule exists because two concurrent web builds took the container down earlier the same day. Every final gate below ran through the wrapper, one at a time.

## Review round 1 (same vendor, under the owner's waiver): approve, no must-fix

The open points, and where each one went:

- **WebKit is the real gate for items 2 and 3.** Both fail only in WebKit, which is not installed here. Do not call the branch fixed until CI's webkit shards pass on the first attempt. For item 3 the bar is the investigation's: 5/5 first-attempt passes of the two-streams test. Kept below under "What is unverified".
- **The cap assertion reads `hls.currentLevel` once, right after the 3 s window.** In Chromium, at dsf 1 and dsf 2 and over three repeats, the cap was applied before the first fragment, so it held. CI WebKit might apply the cap only after segment 0 has loaded at Mux's 720p first level, and then "the rendition playing is within the cap" could go red there. If it does, read the attached `stream-proofs.json` (`levelSwitches`) and treat it as a new finding. It is not a reason to loosen the assertion.
- **`ignoreDevicePixelRatio` is a visible quality trade-off for real hi-DPI browsers** (a Retina admin preview, a browser-based player on a true dpr-2 display): they now get CSS-size renditions. The decision is written into the PR body as well as here, under "The owner's checks".
- **Could the proof carry an old stream's diagnostics after a URL change?** `emit()` now spreads the previous registry entry, which raised the question. Checked at the final gates: no. The stream effect depends on `[url]`, and its cleanup ends with `delete registry[id]`. React runs that cleanup before the new effect, so the first `emit()` for the new URL spreads nothing. The two rings are declared inside the effect, so they also start empty for each URL. Within one URL they are kept across reconnects, on purpose: a reconnect history is part of the evidence. No change needed.
- **Pre-existing, not introduced here:** the decision line is printed when the playlist is picked, so in the "backup is broken too" case it says `showing "Everyday"` while the card is up. This is the lead's call and still open.
- **The tsc outside the wrapper:** see the process note above.

## Final gates (2026-11-23, on `ce6bcafce`)

Every heavy step ran through the lock wrapper, one at a time, while another workflow was also using the machine. The e2e used the same kind of scratch config as above (outside the worktree, never committed), on a fresh production build (`BUILD_ID` 21:54Z) served with `CI=true E2E_PREBUILT=1`.

| Gate | Command | Result |
|---|---|---|
| pnpm lockfile drift | `pnpm install --frozen-lockfile --lockfile-only`, then `git diff --exit-code pnpm-lock.yaml` | pass, no diff |
| Web typecheck | `pnpm --filter web exec tsc --noEmit -p tsconfig.json` (the whole app, e2e specs included) | clean, no output |
| Web build | `pnpm --filter web build` with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`, `NODE_OPTIONS=--max-old-space-size=4096` | pass, 77/77 static pages. CI's build job inlines the production API URL instead; only that string differs. |
| Bundle budget | `node apps/web/tools/check-bundle-budget.cjs` | OK, within the ratcheted ceiling |
| The build job's other checks | `check-client-sentry.cjs` (self-test and check), `check-sw-shell.cjs`, `check-help-prerender.cjs`, `check-brand-contrast.cjs` | all OK |
| Web jest, full | `pnpm --filter web exec jest --ci --maxWorkers=2` | 720/720 suites, 10,607/10,607 tests |
| i18n parity | `check-i18n-parity.cjs` | OK (no new user-facing string on this branch) |
| Mobile performance | `pnpm mobile-perf-guard` | OK |
| Pill rules | `check-pill-rules.cjs` | OK, 58 legacy instances, none above the baseline |
| `inset` serialization | `check-inset-serialization.cjs` | OK, 0 confirmed landmines |
| `taurus-safety.yml` | `check-taurus-safety.cjs`, `check-scene-css.cjs`, `check-variant-registry.cjs`, `check-board-editability.cjs`, `check-widget-truth.cjs`, `check-font-ceilings.cjs` (plus `inset` above) | all OK, within baselines |
| Rulebook | `scripts/check-rulebook.cjs --self-test`, then the check; `check-incident-records.cjs` | PASS, no offences. Re-run after this file was edited: PASS. |
| Request budget | `check-request-budget.cjs --self-test`, then the check; `vercel-ignore-build.test.sh` | OK. Timers 44/44 and 8/8, unchanged. |
| The changed specs, `chromium`, `--retries=0` | `player-bad-file`, `website-tabs`, `streaming-widget` | 17/17 passed, all on the first attempt |
| The two DPR tests, `chromium-dsf2`, `--retries=0` | website-tabs native, two streams | 2/2 passed |
| `emergency-path.yml`'s list, `chromium`, CI's retries | `emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer` | 40 passed, 0 failed, 0 flaky, 1 skipped. The skip is a `test.fixme` that already existed on Chromium in `emergency-drill-paint-proof.spec.ts` ("a page reloaded under a persisted native hold with NO cached alert…"). This branch does not touch that file. |

Not run here, because CI runs them: the API jobs and the Docker boot smoke. This branch changes no file under `apps/api`, `packages/` or any Dockerfile, so they are expected to be unaffected. The WebKit legs of everything above were not run either: WebKit is not installed here.

## What is unverified

- **WebKit (CI is the gate).** Items 2 and 3 fail only in WebKit, and item 1 is also red in webkit 3/4. Do not call any of them fixed until CI's `E2E shard (Playwright / webkit 3/4)` and `webkit 4/4` pass them **on the first attempt**. For item 3 the bar is 5/5 first-attempt passes of the two-streams test. If its new cap assertion goes red there, read `stream-proofs.json` in the HTML report first (see the review section).
- **The rest of the website-tabs test in WebKit.** The lines after the bounds (tap Google, re-show, no blocked card) have not run in WebKit since 700d93b82.
- **Real Safari.** Safari uses native HLS, so hls.js and this cap are not in play there. CI never exercises Safari's own path; Playwright's Linux WebKit is WPE. The `webkit · Emergency path` required check is CI's as well.
- **Real devices.**
  - An APK half-screen stream picking the physical-pixel rendition on a bench screen. Expected: the zone's size in physical pixels, because one CSS px is one physical px there.
  - The website-tabs geometry on the 4K portrait panel. That check has been open since 2026-11-07; this branch changes only the test.
  - The single `PLAYLIST_FALLBACK` line in a real screen's console or bug report.
- **Deploy.** "Done" needs the merge SHA on `master`, CI green, and `/api/v1/health` reporting `commit` equal to it. Until then the branch is unverified.

## The owner's checks

1. **The hi-DPI trade-off (item 3).** Real hi-DPI browsers now get CSS-size renditions (a Retina admin preview; a browser-based player on a true dpr-2 display). The editor's "Test stream" pill shows the preview's rendition, not the source's best. Keep that for every instance (recommended; `/player` must keep the cap either way), or keep the device pixel ratio for the editor's preview only. Separately, decide whether to word the pill as the preview's rendition. This decision is also in the PR body.
2. **If CI WebKit still freezes Mux:**
   - first read the per-stream proof in the failure message;
   - then the skeptic's experiment, on a scratch branch, never the product: cap Mux at its 720p start level;
   - only then a macOS-runner job for this spec's WebKit leg. That is a CI-definition change, which needs your approval and is not in this branch.
3. **The decision line's timing (pre-existing, item 1).** It is printed when the playlist is picked, so it can say `showing "Everyday"` while the card is up because the backup is broken too. This is the lead's call.
4. **Whether the general E2E shards become required checks.** Today they are not, and that is the common reason all three reds reached `master`.
5. **After merge:**
   - confirm the webkit 3/4 and 4/4 shards on the merge commit;
   - confirm `/api/v1/health` `commit`;
   - on a bench screen, play a half-screen stream and open a fallback, then read its console or bug report: one `PLAYLIST_FALLBACK` line for the fallback.
