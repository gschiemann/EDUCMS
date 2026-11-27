# /panic on a phone held sideways: final handoff (2026-11-23)

**Status.** Branch `claude/panic-landscape-phone`, local only. Three commits on top of `claude/panic-short-screen` (`d0e02c205`): the fix with its tests (`8bfb8ad3e`), the design and test record (`b6888ef18`, `docs/handoffs/2026-11-23-panic-landscape.md`) and this final handoff. `claude/panic-short-screen` has merged to `master` (`06e27df28`, PR #352), so against `master` the diff is this branch's own files only: the page, two hooks, the jest file, the e2e spec and two handoffs. It merges into today's `origin/master` with no conflict (`git merge-tree`), and `master` has not touched the panic page, the hooks, the emergency components, the spec, `globals.css` or `emergency-path.yml` since `d0e02c205`. The branch is behind `master`, so the ruleset's strict up-to-date rule needs an update-branch before merge. Not pushed, no PR, not merged, not deployed.

**Life-safety CHANGE class** (`CLAUDE.md` §5): `/panic` is the staff panic trigger on a phone. Before merge it needs the owner's go, the different-vendor review or the owner's written waiver of it, CI green (including the WebKit shard) and the on-glass checks below. Every claim about a real phone here is **unverified** until those checks pass; every WebKit result is **unverified locally** (WebKit is not installed on the machine this ran on).

The design, the four shapes, the class strings and every test are in `docs/handoffs/2026-11-23-panic-landscape.md`. This file holds the two investigations, the sizes, the review round, the final gates, the on-glass checks and the open decisions.

## Investigation 1: why the product failed

**The trigger panel was designed for a phone held upright, and only for one held upright.**

- The idle panel is one column: header, sign-in line, title, LIVE | DRILL, the live-alert line, "Send to", then the six buttons. The buttons sit in a `flex-1 min-h-0 grid grid-cols-2 grid-rows-3` grid, and each button is `aspect-square h-full max-h-[156px] max-w-full`. So a button's size is about a third of the grid's height (less the gaps and padding), and the grid's height is whatever the column above leaves.
- That column is about 330 px tall at 390 px wide with the alert line (331.9 measured; 275.9 without). On a 390 × 844 phone held upright, 844 − 332 leaves plenty. On the same phone held sideways the screen is 390 px tall, the column and the grid's padding take all of it, and **each button measured 2 px tall** (844 × 390, Chromium, against a production build of `d0e02c205`). The 844 px of width, which a sideways phone has plenty of, was never used: the column and the grid are stacked vertically whatever the shape of the screen.
- A second effect of the same design: a button cannot be narrower than its label (Lockdown is 79.2 px wide), so once its row is shorter than that, it stops being a circle. With the alert line that happens below about 634 px tall in portrait, which includes an SE-class phone in Safari (390 × 548 measured 50.7 px and not round).
- The codebase already knew about phones held sideways: `globals.css` has the `short-land` variant and `use-short-landscape.ts` its hook, and the sports console uses them (`ConnectionBanner`, `RecentEventsBar`, `RunMoreMenu`, `ShareConsoleLink`; `git grep short-land origin/master -- apps/web/src`). The panic page never used either.
- The grid is the same in the oldest commit in this clone (`60fc32a28`, 2026-10-23). The clone is shallow, so where the design started is not in reach here.

## Investigation 2: why our system never caught it

**No test, rule, audit item or on-glass check ever put the panic page in landscape or on a short screen.**

- **No spec.** On `master` before PR #352, `emergency-targeting.spec.ts` set two viewports, both 390 wide and upright: 390 × 844 and 390 × 664; PR #352 added 390 × 560 (`git grep -n setViewportSize origin/master -- apps/web/tests/e2e/emergency-targeting.spec.ts`). The two Playwright projects are Desktop Chrome and Desktop Safari (1280 × 720 by default), which have room. The required Emergency path jobs run the player-side specs listed in `emergency-path.yml`; none of them opens `/panic`. The only spec that does is `emergency-targeting.spec.ts` (`git grep "goto('/panic'" origin/master -- apps/web/tests/e2e`), and no spec under `tests/e2e` held the trigger page in landscape.
- **No rule or audit item.** The mobile standard in `apps/web/CLAUDE.md` is about speed (tap lag, polling, blur), not layout. `docs/governance/AUDIT-SURFACE.md` §1 lists "Hold-to-trigger + typed-confirm UX consistency" and §15 lists Safari on every customer-facing surface; neither names an orientation or a screen height.
- **No on-glass check in landscape.** The panic-phones handoff (`docs/handoffs/2026-11-14-panic-phones.md`) says nothing about orientation or viewport (a case-insensitive search for landscape, portrait, viewport, 390 and 844 finds nothing). The hardware qualification matrix is the fleet claim for the player APK; the staff phone that sends the alert has no matrix of devices and orientations.
- **Found by accident.** A measurement made for panic-short found it (`docs/handoffs/2026-11-23-panic-short-screen.md` names it as pre-existing, with no spec covering it), not a gate or an audit.
- **What this branch changes about that:** the spec now has a landscape and short-portrait describe (36 tests) and a tightened 390 × 560 test. It still runs only in the general E2E shards, which are not required, so it can go red without blocking a merge. Making it required is a CI definition change (consequential, the owner's call); the proposal is under "Open decisions". A second proposal for the owner: add "the trigger page at phone portrait, short portrait and landscape" to `AUDIT-SURFACE.md` §1, so audits score it.

## Sizes before and after

Smallest button diameter over the six, Chromium, with the keep-ready card and the live-alert line, en unless noted. **Before** = this branch's spec against a production build of the unfixed page (`d0e02c205`, which is `master`'s panic page); **after** = this branch. Every after-value is round (|w − h| = 0) unless it says otherwise. Values marked † were measured by the review's own probe (83 viewports, before and after scrolling the status column to its end), not by the committed spec.

### Phones held sideways (the brief's sizes first)

| Viewport | Before | After | Shape |
|---|---|---|---|
| 667 × 375 | 2.00 | 107.66 | 2 × 3 |
| 740 × 360 | 2.00 | 113.33 | 3 × 2 |
| 844 × 390 | 2.00 | 148.00 | 3 × 2 |
| 932 × 430 | 11.36 | 156.00 | 3 × 2 |
| 915 × 412 | 5.36 | 156.00 | 3 × 2 |
| 750 × 340 (a 390 × 844 iPhone in Safari, bars showing) | 2.00 | 116.66 | 3 × 2 |
| 734 × 343 | 2.00 | 111.33 | 3 × 2 |
| 712 × 325 | 2.00 | 104.00 | 3 × 2 |
| 568 × 320 | 2.00 | 89.33 | 2 × 3 |
| 658 × 320 | 2.00 | 89.33 | 2 × 3 |
| 667 × 325 † | not run | 91.00 | 2 × 3 |
| 640 × 360 † | not run | 102.66 | 2 × 3 |
| 812 × 375 † | not run | 137.33 | 3 × 2 |
| 852 × 393 † | not run | 150.39 | 3 × 2 |
| 844 × 340 † | not run | 148.00 | 3 × 2 |
| 802 × 293 † | not run | 128.50 | 3 × 2 |
| 896 × 414, 926 × 428, 956 × 440 † | not run | 156.00 | 3 × 2 |
| 640 × 280 † (a 360 × 640-class Android, Chrome's bar showing) | not run | **80.00** (below 88) | 3 × 2 |

### Short portrait

| Viewport | Before | After | Shape |
|---|---|---|---|
| 390 × 799 | 134.36 | 111.33 | compact |
| 390 × 750 | 118.03 | 111.33 | compact |
| 390 × 700 | 101.36 | 111.33 | compact |
| 390 × 664 (a 390 × 844 iPhone in Safari) | 89.36 | 111.33 | compact |
| 390 × 600 | 68.03, not round | 111.33 | compact |
| 390 × 560 | 54.70, not round | 111.33 | compact |
| 390 × 548 (an SE-class phone in Safari) | 50.70, not round | 111.33 | compact |
| 375 × 548 | 50.70, not round | 106.33 | compact |
| 360 × 640 | 81.36 | 101.33 | compact |
| 360 × 560 † | not run | 101.33 | compact |
| 393 × 660, 412 × 700, 414 × 715 † | not run | 112.33, 118.66, 119.33 | compact |
| 428 × 746, 430 × 739 † | not run | 124.00, 124.66 | compact |
| 320 × 568 † | not run | 88.00 | compact |
| 360 × 500 † | not run | **87.75** (0.25 below 88) | compact |
| 390 × 480 † | 28 (panic-short's measurement) | **77.75, not round** (by 1.47 px) | compact |
| 320 × 460 † | about 21 (review) | **52.00, not round** (79 × 52) | compact |

### Unchanged at 800 px and taller (`tall`, byte-identical to panic-short)

| Viewport | Before | After |
|---|---|---|
| 390 × 800 | 110.03 | 110.03 |
| 390 × 844 | 124.70 † | 124.70 |
| 360 × 800 | 104.03 † | 104.03 |

The review rendered `d0e02c205`'s page and this branch's page in jsdom in the tall shape: `innerHTML` is identical (17,403 bytes) with the card and the alert line, and with the card and no alert line.

### Other languages

es and zh give the en sizes in landscape (844 × 390: 148.00; 667 × 375: 107.66). In portrait es is row-bound by its longer copy: 390 × 548 gives 103.50 and 375 × 548 gives 96.00 †; zh gives 111.33 at 390 × 548. Before: es 390 × 548 was 45.20 and not round; every landscape size was 2.00.

### Where 88 px cannot be met

All measured (the design record's "calculated" list is corrected by these):

- **640 × 280** (sideways Android with the browser bar showing): 80 px, round. The status column's 340 px minimum is the limit; 3 × 2 needs at least 664 px of width for 88 px.
- **360 × 500**: 87.75, round. **390 × 480**: 77.75, not round by 1.47 px. **320 × 460**: 52, not round (79 × 52). The first figure for 320 × 460 (67.8) was a calculation with the 390-wide stack; it is corrected in the design record. A 320-wide Safari viewport (an iPhone with Display Zoom) is below the floor; 320 × 568 is exactly 88.
- **Narrow windows that are wider than tall and 540 px tall or less**, under about 560 px wide (an Android phone in split-screen, a small desktop window): they take the landscape shape, whose status column never goes below 340 px, so the buttons get what is left: 412 × 400 gives 14 px (and three of the six fail a centre hit test †), 450 × 412 gives 33, 480 × 320 gives 48, 541 × 540 gives 78.5, 560 × 249 gives 65.66 and not round †. `master` is worse at every one of these (about 1 to 5 px; 48 at 541 × 540), so this is not a regression, but the compact shape would do better there (about 37 at 412 × 400, 107 at 541 × 540). Proposed follow-up under "Open decisions".
- **690–699 × 311–315** †: two across gives 86.3–86.7, where three across would give about 99. No phone known to us has that viewport.

## The review round

One round, **approve**, no must-fix. It ran on the same vendor as the author. What it ran and found, and what was done:

- **Reran** (fresh production build of `b6888ef18`, Chromium 1243): `emergency-targeting.spec.ts` 44 passed; jest for `src/app/panic`, `src/hooks` and `src/components/emergency` 171 passed in 25 suites; check-inset-serialization, check-i18n-parity and check-rulebook pass.
- **Its own probe** (83 viewports; values marked † above): at every size in the brief and every real phone size it tried, all six buttons in the viewport, round, at least 88 px, at least 12 px apart, hit-testable at the centre and four off-centre points, unmoved by scrolling the status column, no page scroll.
- **Rotation mid-hold:** a real pointer hold on Lockdown while the viewport flipped through 844 × 390, 390 × 664, 667 × 375, 750 × 340, 390 × 844, 568 × 320 and 390 × 548 kept the same six button nodes and the same grid node at every step; a release at about 2.1 s sent nothing; the full hold sent exactly one trigger with the pre-targeting arguments.
- **The tests have teeth:** `key={layout}` on the grid fails jest 8.4 and block 7's mid-hold test; forcing the phone row above the grid fails six tests.
- **Nothing visible removed:** the same 53 visible items in the tall shape, both landscapes and compact (compact adds only the below-grid wrapper).
- **Should-fix items, and what happened:**
  1. *Narrow "landscape" windows* (above): **not changed here**; it would change the reviewed page, it is not a regression and it is outside the brief's sizes. Follow-up proposed below.
  2. *Spanish cut in the landscape status column:* in es the "Send to" label "Todas las pantallas (24)" shows as "Todas las panta…" (122 px of the 163 it needs) and the alert line "Médica — Lobby, 1 pantalla" as "Médica — Lobby, 1 …" at every landscape phone width up to 850; at 932 × 430 the label is still cut (155 of 163). en and zh are not cut. It is the label's existing ellipsis (`master` already cuts it in portrait at 360 wide), so no content is removed, but in Spanish landscape the screen count cannot be read. **Not changed here**; options under "Open decisions".
  3. *Boundary dip at 690–699 × 311–315:* recorded above; no change.
  4. *Handoff correction (320 × 460):* **fixed** in `docs/handoffs/2026-11-23-panic-landscape.md` and recorded here.
  5. *Process:* the review is same-vendor, so it is not the different-vendor review. The owner's written waiver ("Don't worry about another model review") is on record for panic-short and this change relies on it; if the owner did not mean it to cover this change, a different vendor reviews this diff before merge.

## Final gates

On `b6888ef18` (code unchanged since; the commit after it is documentation only), 2026-11-24, every heavy command alone through the machine's lock wrapper on a 4-CPU / 16 GB container. Chromium is the preinstalled headless shell build 1243 (the repo's Playwright wants 1217), through a wrapper config outside the repository; the production build used `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1` and was served by `tests/e2e-webserver.cjs` with `CI=true E2E_PREBUILT=1` on a spare port (another workflow held 3000).

| Gate | Result |
|---|---|
| `pnpm lockfile drift` (`pnpm install --frozen-lockfile --lockfile-only`, then `git diff --exit-code pnpm-lock.yaml`) | pass, unchanged |
| Web typecheck (`pnpm --filter web exec tsc --noEmit`; includes `tests/e2e`) | pass, exit 0 |
| Web production build (`pnpm --filter web build`) | pass, exit 0; the `/panic` client chunk and the built CSS carry `--panic-btn-max` |
| `check-bundle-budget.cjs` | pass: 2,181 chunks, 20.16 MB, within the ceiling |
| The rest of the web build job (`check-client-sentry` and its self-test, `check-sw-shell`, `check-help-prerender`, `check-brand-contrast`, `check-csp-prerender`) | pass |
| Web jest, full suite (`--ci --maxWorkers=2`) | pass: 724 of 724 suites, 10,728 of 10,728 tests (`panic-page.test.tsx` among them) |
| `check-i18n-parity` | pass: 7,691 keys in en, es and zh (no new string) |
| `pnpm mobile-perf-guard` | pass |
| `check-pill-rules` | pass: 58 legacy, none above baseline |
| `check-inset-serialization` | pass: 0 confirmed landmines; none of its manual-review flags is in a changed file |
| `scripts/check-rulebook.cjs` (and `--self-test`) | pass |
| `check-request-budget` (and `--self-test`) | pass (no new network call) |
| Chromium e2e, `emergency-targeting.spec.ts` plus the `emergency-path.yml` list (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`), one run, `--workers=1`, CI retries | **84 passed, 1 skipped, 0 failed, 0 flaky** (5.8 min); all 44 targeting tests passed on the first try. The skip is the existing Chromium `test.fixme` in `emergency-drill-paint-proof.spec.ts` |
| WebKit, every spec | **not run here** (not installed): unverified locally; CI's `webkit · Emergency path` job and the general E2E WebKit shard (which runs `emergency-targeting.spec.ts`) are its gate |

## On-glass checks (the owner, before merge)

On a test tenant or a bench screen, **DRILL only**: never a live alert from these checks (`CLAUDE.md` §5).

| Phone | Browser | Orientation | Expected viewport and shape |
|---|---|---|---|
| iPhone SE (2nd or 3rd generation, 375 × 667) | Safari | portrait | about 375 × 548: compact, about 106 px |
| iPhone SE | Safari | landscape | about 667 × 325 to 667 × 375: 2 × 3 beside the status column, 91 to 108 px |
| iPhone SE | the installed app (Add to Home Screen) | portrait | about 375 × 667: compact, about 106 px |
| iPhone SE | the installed app | landscape | 667 × 375: 2 × 3, about 108 px |
| a 6.1-inch phone (an iPhone 12 to 14 at 390 × 844; a 15 or 16 is 393 × 852 and measures within about 3 px) | Safari | portrait | about 390 × 664 with the bars, 390 × 750 without: compact, about 111 px |
| a 6.1-inch phone | Safari | landscape | about 750 × 340: 3 × 2, about 117 px |
| a 6.1-inch phone | the installed app | portrait | 390 × 844: tall, unchanged from today |
| a 6.1-inch phone | the installed app | landscape | 844 × 390: 3 × 2, 148 px |

On each:

1. Six round buttons, all visible without scrolling, none overlapping; LIVE | DRILL, the alert line (if one is active) and "Send to" readable (in Spanish landscape the "Send to" label is cut; see "Open decisions").
2. With DRILL chosen, a hold on one button takes 3 seconds and sends one drill; a release before 3 seconds sends nothing.
3. Still in DRILL, start a hold and rotate the phone mid-hold: it never sends early. (iOS may cancel the hold on rotation; that is the safe direction.)
4. In landscape, scroll the status column to the keep-ready card: the buttons stay still while it scrolls and bounces; a press during the bounce behaves acceptably.
5. Optional (the narrow-window case above): an Android phone in split-screen, to see whether the follow-up is worth doing first.

## Open decisions for the owner

1. **Go / no-go to merge** (life-safety CHANGE class), after CI is green on the PR, including the WebKit shard, and the on-glass checks above.
2. **The different-vendor review:** confirm the waiver covers this change, or ask for a different-vendor review.
3. **Make the panic layout spec a required check** (re-proposed from panic-short; decision format in `docs/handoffs/2026-11-23-panic-landscape.md`): add `tests/e2e/emergency-targeting.spec.ts` to the `Run emergency-path E2E` step in `.github/workflows/emergency-path.yml`. The required job names do not change.
4. **Narrow landscape windows** (follow-up): add a minimum width of about 560 px to the landscape condition in `use-panic-layout.ts` so narrower windows fall to compact, with e2e tests at 541 × 540 and 450 × 412 and the jest query matrix extended. About 37 px at 412 × 400 and 107 at 541 × 540 instead of 14 and 78.5.
5. **Spanish in the landscape status column:** accept the cut; let the "Send to" label and the alert line wrap to two lines in landscape; or widen the column where the buttons are already capped at 156 px (915 px wide and up costs nothing; es needs about 381 px, so the planned 360 px fallback is not enough). Whichever, add an es assertion to the spec.
6. **Audit surface:** add the trigger page at phone portrait, short portrait and landscape to `docs/governance/AUDIT-SURFACE.md` §1.

## Rollback

Revert the PR. No API, schema, player, widget or Taurus-shipped file changes; the page goes back to panic-short's, which is today's `master`.
