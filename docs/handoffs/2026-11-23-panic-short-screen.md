# /panic on a short screen: the six buttons own the space (2026-11-23)

**Status.** Branch `claude/panic-short-screen`, cut from `origin/master` `1006d21b2`. Three commits: the fix (`e3030be5e`), two e2e assertions review round 1 asked for (`bdb4e071c`) and this handoff. Not pushed, not merged, not deployed. `origin/master` has since moved to `a884ada3b` (PR #350, the rebrand / spell-check / runner-pin train); it changes no file under `apps/web/src/app/panic/`, no emergency component and neither changed spec, and `git merge-tree` reports no conflict, but the ruleset is strict up-to-date, so the branch needs an update-branch before it can merge, and CI on that merged head is the gate. Every claim about a real phone below is **unverified** until the owner's on-glass checks pass. WebKit is not installed in the machine this was built on, so every WebKit result is **unverified locally**; CI's WebKit shards are the gate for it.

- **The owner's go:** "merge and finish everything" (after the 2026-11-23 demo).
- **Life-safety CHANGE class** (`CLAUDE.md` §5): this is the staff panic trigger on a phone. The owner waived the different-vendor review in writing ("Don't worry about another model review"). The waiver covers the review only: the on-glass check on a real phone stays the owner's.
- **Not touched:** `HOLD_DURATION_MS`, the pointer and key handlers, every aria-label, the trigger buttons' classes and styles, LIVE | DRILL, the live-alert line, the "Send to" bar, every string. No API, schema, player, widget or Taurus-shipped file changes. No new user-facing string.

## What changed

| Screen height | Before (since 2026-11-16) | Now |
|---|---|---|
| 800 px and taller | The panic-phone row sits between the "Send to" bar and the buttons. | Unchanged. The rendered DOM is byte-identical to `master` (checked, below). |
| Under 800 px | Same place, so every pixel of the row came off the buttons. | The row moves **below** the buttons, starting at the bottom edge of the screen. The panel scrolls a little to reach it. The buttons are sized exactly as if the row were not there. |

"The panic-phone row" is either the "Keep this phone ready for emergencies" card (`panic-keep-ready`: a signed-in person with panic authority on a phone that is not set up) or the "This phone is ready" line (`panic-phone-ready`: a set-up phone). Same test ids, copy and handlers. Reading and focus order follow the DOM, so a keyboard or screen-reader user meets the six buttons before the row, as a sighted user does.

- `(max-height: 799px)` is `apps/web/src/hooks/use-short-panic-screen.ts`: `useSyncExternalStore` on `matchMedia`, false on the server and in jsdom, the same pattern as `use-short-landscape.ts`. It matches a 390 × 844 iPhone in Safari whichever viewport WebKit measures (about 664 px with toolbars, about 750 px without).
- **It also matches short laptop browser windows** (about 657 px on a 1366 × 768 screen): desktop `/panic` users at that height get the moved card and the scroll too. That is intended (the buttons own the space there as well), but it is a change for them.
- **No size floor.** On a shorter screen the buttons shrink with their rows, exactly as they did before 2026-11-16, and never move below the fold. A fixed 88 px floor was proposed and rejected by the skeptic: below about 636 px it would have pushed the bottom row off the screen.

### One deliberate departure from the brief's wording

The brief said to wrap the header-to-grid panel in one viewport-tall flex column and render the row after it. That gives the right geometry, but it puts the grid under a new parent element in short mode, so React **remounts every trigger button** whenever the layout crosses 800 px. A rotation during a hold would detach the pressed button: its pointer capture is gone, and an early release could land on another element, so the 3-second hold would complete and send although the finger left early. (Reasoned from how pointer capture ends when an element is removed; not reproduced on a device.)

So the row is instead rendered after the grid, positioned `absolute top-full left-0 right-0` against the `fixed` root (out of the flex column, starting exactly at the bottom edge of the screen), and the root gets `overflow-y-auto`. The flex column is laid out exactly as if the row did not exist, which is the wrapper's purpose. The grid keeps the same place in the tree in both layouts. A jest test starts a hold, flips the media query one second in, checks that all six buttons are the same DOM nodes, releases early on the same node and checks that nothing is sent. With the grid forced to remount (`key` on the grid, a negative control), that test fails.

The below-grid container renders only when a row will show, so it never takes space for nothing.

### A second departure: the 390 × 560 test does not assert "round"

The brief asked the new 390 × 560 test (card plus live-alert line) to assert that all six buttons stay circles. They cannot, with or without the card, and the cause is not the card. At 560 px the rows are 54.7 px, and a button cannot be narrower than its label's min-content width: Lockdown measured **79.22 × 54.7** and Fire / Evacuate 71.2 wide. The run with that assertion failed on every retry with `|w − h|` = 24.515625. With the card dismissed the DOM is `master`'s and the numbers are identical, so it was the same before 2026-11-16. Making them round needs a change to the buttons (their classes are out of scope here) or to the content above the grid, which is an owner decision. The test asserts what the design guarantees instead: all six buttons on screen and apart, the card below them, and **identical button sizes with the card and after "Not now"**, so the card costs them nothing. A fixed 88 px floor would fail it (the bottom row would leave the screen), and so would `master` (the card above the grid takes 74 px off the rows).

Measured in Chromium on this branch (with the live-alert line / without it). Button size is the smallest button's height; "round" means every `|w − h|` < 2.

| Viewport | Buttons with the card | Same after "Not now" | Round |
|---|---|---|---|
| 390 × 844 (row above, as before) | 124.7 / 143.4 | 149.4 / 156 | yes |
| 390 × 750 | 118.0 / 136.7 | same | yes |
| 390 × 664 | **89.4** / 108.0 (CI on `master`: 64.70) | same | yes |
| 390 × 600 | 68.0 / 86.7 | same | no / yes |
| 390 × 560 | 54.7 / 73.4 | same | no |
| 390 × 548 and 375 × 548 | 50.7 / 69.4 | same | no |
| 1366 × 657 (a laptop window) | 87.0 / 105.7 | same | yes |

The buttons are round from about 634 px tall with the live-alert line (578 px without). The 1366 × 657 laptop window with the alert line gets 87.0 px buttons, under the spec's 88 px, whether or not the card is there; it is outside the phone-sized checks. On every short viewport the card starts exactly at the bottom edge of the screen (the card is 70 px plus a 4 px margin).

## Why the product failed

`4773ff3ac` ("feat(panic): panic phones, web half", 2026-11-14, merged in the 2026-11-16 release train `d6b113aaa`, PR #329) put the keep-ready card and the phone-ready line directly above the trigger grid. The grid is `flex-1 min-h-0`, and each button is `aspect-square h-full max-h-[156px]`, sized by its row. So a third of every pixel added above the grid came off each row.

At 390 × 664 (Safari with its toolbars) with the live-alert line:

- Above the grid before the card: 331.9 px. Fixed grid overhead: 64 px (8 top padding, 24 bottom, two 16 px gaps).
- Rows without the card: (664 − 331.9 − 64) / 3 = **89.37 px**, a pass with 1.37 px to spare.
- The card takes 74 px: 70 px tall (its 12 px text wraps to three lines next to its two buttons) plus a 4 px margin.
- Rows with the card: (664 − 405.9 − 64) / 3 = **64.70 px**. CI received exactly 64.703125, in Chromium and WebKit, on every retry, on every master commit from `d6b113aaa` on. At that size Lockdown (79.2 px wide) and Fire / Evacuate (71.2 px wide) were not even circles.
- With no live-alert line the card gave about 83 px, still under the 88 px floor. A set-up phone (the ready line, about 52 px) gave about 72 px; no spec covered that case before this change.

The design rule it broke is written in the page: the live-alert line is "one compact line, so the trigger grid keeps its size". The spec asserted that rule correctly; the test was not wrong.

## Why our system let it reach customers

1. **The spec that caught it is not a required check.** `emergency-targeting.spec.ts` runs only in the general E2E shards (`ci.yml`, "E2E shard (Playwright / …)"). `CLAUDE.md` §10 makes `chromium · Emergency path` and `webkit · Emergency path` required, and those run five other specs. The emergency trigger's own layout test could go red without blocking a merge.
2. **The release train merged with this spec red.** The `claude/panic-device` branch head (`82b5d77ff`) was already red on exactly this assertion (chromium 2/2 and webkit 3/4) before the train, and the train merged on 2026-11-16 with it red. It stayed red on every master commit CI reported for a week, through at least PR #345's head (`8c69312`).
3. **The gap was written down and nothing acted on it.** `docs/handoffs/2026-11-14-panic-phones.md` lists "Browser e2e, including `emergency-targeting.spec.ts`" under **Unverified**. An unverified life-safety layout claim had no gate, owner or follow-up attached.
4. **No other test measures `/panic`.** The jest page test checks text and clicks (jsdom has no layout); the root `tests/e2e` panic specs and `mobile-usability.spec.ts` check no sizes.

## Proposal (not implemented): make the panic layout spec a required check

A CI definition change is consequential (`AGENTS.md`) and needs the owner's written go, so this branch does not make it.

- **Situation.** The `/panic` trigger's geometry and hold contract (`apps/web/tests/e2e/emergency-targeting.spec.ts`) can go red without blocking a merge, and did, for a week.
- **Evidence.** The section above. The whole spec (8 tests) ran in about 30 s of test time in Chromium locally (results below; WebKit not timed here) and is fully mocked, like the five specs the Emergency Path job already runs.
- **Recommendation.** Add `tests/e2e/emergency-targeting.spec.ts` to the `Run emergency-path E2E` step's file list in `.github/workflows/emergency-path.yml` (both matrix browsers). The two job names, which the ruleset already requires, do not change, so the ruleset needs no edit.
- **Risk.** A flaky test there would block merges. Mitigation: the spec has been deterministic (one fixed value on every retry); retries are already 2 in CI.
- **Validation.** One PR run of both Emergency Path jobs showing the spec green; one deliberate red (revert this fix on a scratch branch) showing the job red.
- **Rollback.** Remove the path from the step.
- **Decision.** Owner.

## Tests

`apps/web/src/app/panic/__tests__/panic-page.test.tsx`, new block 7 (jsdom, `matchMedia` mocked):

- matching `(max-height: 799px)`: the keep-ready card follows all six buttons, inside the below-grid container, and the root scrolls;
- not matching: today's order, no below-grid container, no scrolling root;
- the card dismissed: no below-grid container at all;
- a set-up phone: the ready line and its Turn off control follow the buttons;
- crossing 800 px mid-hold: the buttons are the same DOM nodes and an early release still sends nothing.

`apps/web/tests/e2e/emergency-targeting.spec.ts` (tightened; nothing loosened or removed):

- **390 × 664** (the failing test, its assertions unchanged): it now waits for the keep-ready card before measuring, then also asserts the card's top is at or below the bottom row's bottom and that it is fully in view after `scrollIntoViewIfNeeded`.
- **390 × 844, new:** the card is fully in view and above the top row; the six buttons are at least 88 px, round, on screen and apart.
- **A set-up phone at 390 × 664, new:** marker cookie, `/api/panic/status`, `/targets` and `/active` mocked, no tab session. The same 88 px round-button checks; the ready line is below the buttons and reachable.
- **390 × 560 with the card and the live-alert line, new:** all six buttons on screen and apart; the card below them; and after "Not now" the buttons are exactly the same size, so the card costs them nothing. Not round at this height (see "A second departure"). Added after review round 1: with the card the panel's own scroll box (the `fixed` root around the grid) has something to scroll, and after "Not now" it has nothing (`scrollHeight <= clientHeight`), so the below-grid row never leaves a scroll behind.
- **Scrolled down to the card at 390 × 664, new after review round 1:** with the live-alert line, scrolled until the card is fully in view, the six buttons are still on screen and apart, a 1.2 s press sends nothing, and the full hold sends exactly the pre-targeting arguments (no `target`).

## Review round 1 (same vendor, under the owner's written waiver): approve, no must-fix

The reviewer re-ran everything on `e3030be5e` in Chromium (jest 21/21; the spec plus the Emergency Path list 47 passed, 1 skipped, the skip being the existing quarantine) and measured by hand. Its points for the owner, kept here because no test pins most of them:

- **The whole trigger panel scrolls on a short screen while a row shows.** In a touch test a drag that started on the header moved the panel 76 px of its 90 px extent, which takes the 76 px header off screen; LIVE | DRILL and all six buttons stayed visible. A touch hold that started on a button while fully scrolled, with 40 px of finger drift, still fired after 3 s, and a 1 s touch sent nothing (the second half is now pinned by the new e2e test, with a mouse). **On iOS, check that a press during momentum scroll or rubber-banding behaves acceptably** — not testable here.
- **Below about 634 px tall with a live-alert line the buttons are not circles**, with or without the card, exactly as on `master`. Lockdown measured 79.2 × 54.7 at 390 × 560 with the card dismissed (`master`'s DOM). The card does not cause it; it is a button-size decision for the owner.
- **Pre-existing, not caused by this branch, no spec covers it:** in phone landscape (844 × 390) the trigger buttons collapse to about **2 px tall**, with or without the card; at 390 × 480 they are 28 px tall. A staff member who opens `/panic` on a phone held sideways gets an unusable trigger panel today. Recommended as its own follow-up (a layout decision for landscape and very short screens, with a spec), not folded into this change.
- **The layout jumps at the threshold:** at 390 × 800 with the card the buttons are 110 px (card above), at 390 × 799 they are 134 px (card below). Safari's toolbar collapse on a tall phone may cross 800 px, so the row can move while the page is open; the buttons are never remounted by that move (jest pins it). Try a 932 px-class phone.
- **Watch the non-required general E2E WebKit shard on the PR**, not only the two required Emergency Path jobs. The fix depends on WebKit counting an `absolute top-full` child of a `fixed overflow-y-auto` root as scrollable overflow, and that shard (it runs `emergency-targeting.spec.ts`) is the only WebKit gate for it.
- Both departures from the brief (no viewport-tall wrapper; no "round" assertion at 390 × 560) hold up on its own measurements: identical button boxes with the card and after "Not now" at 390 × 664 (89.4 px), 390 × 560, 390 × 480, 390 × 799 and 844 × 390; at 390 × 800 the card is still above the grid and the root does not scroll; with no row showing the root's `scrollHeight` equals its `clientHeight` at every short size.

## Verification record

All local, on a 4-CPU / 16 GB container, against a production build (`next build` with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`, served by `tests/e2e-webserver.cjs` with `CI=true E2E_PREBUILT=1`). Chromium is the preinstalled headless shell build 1243 (the repo's Playwright wants 1217), through a wrapper config outside the repository. **WebKit is not installed here: every WebKit result is unverified locally**, and CI's WebKit shards and `webkit · Emergency path` are its gate.

### Final gates, on `bdb4e071c` (clean tree; this handoff is the only later change)

Each heavy command ran alone, through the machine's lock wrapper.

| Gate | Result |
|---|---|
| `pnpm lockfile drift` (`pnpm install --frozen-lockfile --lockfile-only`, then `git diff --exit-code pnpm-lock.yaml`) | pass, lockfile unchanged |
| Web typecheck (`pnpm --filter web exec tsc --noEmit`; the tsconfig includes `tests/e2e`) | pass, exit 0 |
| Web production build (`pnpm --filter web build`, its TypeScript pass included) | pass, exit 0; the `/panic` client chunk contains `(max-height: 799px)` and `panic-phone-row-below` |
| `check-bundle-budget.cjs` | pass: 2,181 chunks, 20.13 MB, within the ceiling |
| The rest of the "Web typecheck + build" job: `check-client-sentry` (and `--self-test`), `check-sw-shell`, `check-help-prerender`, `check-brand-contrast`, `check-csp-prerender` | all pass |
| Web jest, full suite (`--ci --maxWorkers=2`) | pass: 720 of 720 suites, 10,602 of 10,602 tests |
| `check-i18n-parity` | pass: 7,671 keys in en, es and zh (no new string) |
| `pnpm mobile-perf-guard` (`check-mobile-perf.cjs`) | pass |
| `check-pill-rules` | pass: 58 legacy, none above baseline |
| `check-inset-serialization` | pass: 0 confirmed landmines |
| `taurus-safety.yml` scripts: `check-taurus-safety`, `check-scene-css`, `check-variant-registry`, `check-board-editability`, `check-widget-truth`, `check-font-ceilings` | all pass (no player, widget or Taurus-shipped file is touched) |
| `scripts/check-rulebook.cjs` (and `--self-test`) | pass |
| `check-request-budget` (and `--self-test`) | pass (no new network call) |
| Chromium e2e: `emergency-targeting.spec.ts` plus the `emergency-path.yml` list (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`), one run, `--workers=1` | pass: 48 passed, 1 skipped, 0 failed, 0 flaky. All 8 targeting tests passed, including the two new ones. The skip is the existing Chromium quarantine in `emergency-drill-paint-proof.spec.ts` |
| WebKit, every spec | **not run here** (not installed): unverified locally; CI is its gate |

The two assertions added in `bdb4e071c` are not vacuous. In the 390 × 560 test, the same probe first has to find a scroll with the card showing (`scrollHeight > clientHeight`), and only then the absence of one after "Not now". The scrolled-hold test asserts `scrollTop > 0` before it presses. On `master` both would fail at those points, because the card sits above the grid and nothing scrolls. That is reasoned from the DOM: no second negative-control build was run for them.

### While building, on `e3030be5e`

- **`emergency-targeting.spec.ts`, Chromium, on this branch:** 7 passed, 0 failed (the formerly red 390 × 664 test included).
- **The `emergency-path.yml` Chromium list** (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`) **plus `emergency-targeting`**, one run: 47 passed, 1 skipped, 0 failed. The skip is the Chromium quarantine already in `emergency-drill-paint-proof.spec.ts` since 2026-10-26 ("a page reloaded under a persisted native hold with NO cached alert…").
- **Negative control:** the same spec against a build of `master`'s `page.tsx`, no retries: 3 failed, 4 passed. The 390 × 664 test got **64.703125** (CI's value exactly), the set-up phone **72.03125**, and the 390 × 560 test failed on the card's position (331.89, above the grid). The 390 × 844 test passes on `master` too, as it should.
- **Jest:** `src/app/panic/__tests__/panic-page.test.tsx`, 21 passed (16 existing, 5 new). Negative controls: against `master`'s page, 4 of the 5 new tests fail (the "not matching" one passes, as it should). With the grid forced to remount on the flip, the mid-hold test fails at the node-identity check.
- **800 px and taller is byte-identical:** in jsdom (no `matchMedia`, so the hook reads false), `container.innerHTML` from `master`'s page and from this branch's page are byte-identical for a signed-in admin with the card and a live alert (17,408 bytes) and for a set-up phone (17,314 bytes).
- **Required-job equivalents:** `pnpm --filter web build` (its TypeScript pass included), exit 0; `node apps/web/tools/check-bundle-budget.cjs`, OK. **Other guards:** i18n parity OK (no new string); `check-inset-serialization.cjs` clean; `check-mobile-perf.cjs` clean; `check-request-budget.cjs` OK (no new network call); `scripts/check-rulebook.cjs` PASS. ESLint on the four changed source files: the same findings, by rule and count, as `master` (all pre-existing), and none in the new hook.
- **Mount:** the edited component is the `/panic` route's own `page.tsx`. Every e2e above loads `/panic`, and the production bundle's `/panic` server chunk and client chunk both contain the new code.

## Unverified, and left alone

- **A real phone.** Owner on-glass checks: iPhone SE-class Safari (about 548 px tall), 390 × 844 Safari with toolbars shown and as the installed app, each as an unenrolled admin (the keep-ready card) and as a set-up phone (the ready line). Check that the six buttons are fully visible with no scroll (round at 390 × 844 Safari with toolbars; at about 548 px they cannot be, see "A second departure"), that the row is one short scroll below them, and that a hold still takes 3 seconds — including a hold that starts while the panel is still moving (momentum scroll, rubber-banding). Also open it on a 932 px-class phone and collapse Safari's toolbars by scrolling, to see the row move across the 800 px threshold.
- **Which viewport iOS Safari measures `(max-height)` against** (small or large). 799 px is chosen to match both on a 390 × 844 phone; on a 932 px-tall phone Safari's two viewports may sit either side of 800, so the row could move when the toolbars collapse. The buttons are never remounted by that move.
- **WebKit**, locally (not installed here). CI's WebKit shards are the gate.
- **es and zh** wrapping of the card at 390 px: the card is out of the buttons' way on a short screen whatever its height.
- **Left alone (pre-existing, outside the brief):** at 390 × 844 the buttons still shrink, from about 149 px to about 125 px, when the card appears after the sign-in check resolves, which is a layout shift under the thumb. Landscape and widths other than 390 and 375 are not asserted by any spec.
- **Discoverability.** On a short screen the keep-ready offer is below the fold until the person scrolls. That is the trade the brief chose: the offer gives way to the buttons.

## Rollback

Revert the commit. No schema, no API, no stored state.
