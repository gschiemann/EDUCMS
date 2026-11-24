# /panic on a phone held sideways, and on short portrait screens (2026-11-23)

**Status.** Branch `claude/panic-landscape-phone`, local only, cut from `claude/panic-short-screen` at `d0e02c205`. That branch has since merged to `master` (`06e27df28`, PR #352), so this branch sits on top of `master`'s panic page and needs an update-branch before it can merge. Two commits: the fix with its tests (`8bfb8ad3e`) and this handoff. Not pushed, no PR, not merged, not deployed. Every claim about a real phone below is **unverified** until the owner's on-glass checks pass. WebKit is not installed on the machine this was built on, so every WebKit result is **unverified locally**; CI's WebKit shards are its gate.

- **Life-safety CHANGE class** (`CLAUDE.md` §5): `/panic` is the staff panic trigger on a phone. It needs the owner's go, a different-vendor review and the on-glass checks below. The owner's written waiver of the different-vendor review ("Don't worry about another model review") was given for panic-short. **It has not been asked for this change and is not assumed:** the owner must either waive it again in writing or have a different vendor review this diff.
- **Not touched:** `HOLD_DURATION_MS`, the pointer and key handlers, every aria-label, the button colours, labels, DRILL badge and progress ring, LIVE | DRILL (`LiveDrillSwitch`), the live-alert line, the "Send to" bar (`EmergencyTargetBar`), every string. No API, schema, player, widget or Taurus-shipped file changes. No new user-facing string.

## The failure (pre-existing on `master`, found while measuring panic-short)

The trigger grid was a 2 × 3 `flex-1 min-h-0` column under a header / sign-in line / title / LIVE | DRILL / alert line / "Send to" stack about 330 px tall (331.9 px at 390 wide with the alert line). Each button is `aspect-square h-full`, sized by its row. On a phone held sideways (390 px tall) that left the rows nothing:

- **844 × 390: the six buttons measured 2.00 px tall** (Chromium, this branch's spec against the unfixed page). Every landscape phone size measured 2.00 px, except 915 × 412 (5.36) and 932 × 430 (11.36).
- Short portrait: 54.7 px at 390 × 560, 50.7 px at 390 × 548, not round below about 634 px tall with the alert line (Lockdown cannot be narrower than its label, 79.2 px).
- No spec covered landscape or a portrait screen under 664 px.

## What changed

One hook, `apps/web/src/hooks/use-panic-layout.ts`, gives the page one of four shapes. It uses `useSyncExternalStore` over three `matchMedia` lists in classic media syntax (Tailwind v4's `min-[..]` / `max-[..]` variants compile to range syntax, which Safari matches only from 16.4), keeps the `addListener` fallback for Safari before 14, and reads `'tall'` on the server and wherever there is no `matchMedia`.

| Shape | When | What it looks like |
|---|---|---|
| `tall` | 800 px tall or more, any orientation | Exactly the panic-short page, byte for byte (checked, below). |
| `compact` | under 800 px tall, not phone landscape: every short portrait phone, plus laptop windows and tablets in landscape 541–799 px tall | The same stack with tighter spacing (nothing hidden) and the grid **three across, two down**. The panic-phone row stays below the grid, as on panic-short. |
| `land2x3` | phone landscape (`(orientation: landscape) and (max-height: 540px)`) under 700 px wide with an aspect ratio under 9/4: 568 × 320, 640 × 360, 658 × 320, 667 × 375 | The stack becomes a status column on the left, 340–400 px wide (`clamp(340px, 40vw, 400px)`). The grid is `position: fixed` in the rest of the width, two across. |
| `land3x2` | every other phone landscape | The same, three across. |

The queries: `SHORT_LANDSCAPE_QUERY` is imported from `use-short-landscape.ts` (the same query as the `short-land` variant in `globals.css`); `PANIC_WIDE_LANDSCAPE_QUERY` is `(min-width: 700px), (min-aspect-ratio: 9/4)`; `SHORT_PANIC_SCREEN_QUERY` stays in `use-short-panic-screen.ts`. The boolean `useShortPanicScreen` hook had no other importer (grep) and was folded into the new one; the file now holds only the constant.

In `apps/web/src/app/panic/page.tsx` (idle return only):

- Every class string is a module-level literal, so Tailwind sees it whole, and every `tall` string is the panic-short text exactly.
- **Dense stack** (compact and both landscapes): header `pt-[max(0.5rem,…)] pb-1` (was `pt-[max(1.25rem,…)] pb-3`), sign-in line `py-1` (was `py-2`), title block `pb-1`, h1 `leading-tight`, hold hint `mt-0.5`, controls `space-y-1.5`. About 296.5 px of stack with the alert line at 390 wide, 242.5 without (331.9 / 275.9 before).
- **The grid is the same element in the same slot in every shape**; only its `className` and `style` change. `tall` renders no `style` attribute. The other shapes set `--panic-btn-max`, the column's width capped at 156 px; the button's one changed token is `max-h-[156px]` → `max-h-[var(--panic-btn-max)]`, so each button is min(row, column, 156) and round. `max-w-full` stays as the never-overlap safety net. Longhand sides only, never `inset`.
- **Landscape root:** `paddingRight: calc(100% - var(--panic-status-w))` makes the root's own flow the status column; the grid is `fixed top-0 right-0 bottom-0` with `left: var(--panic-status-w)`, out of that flow, so the column scrolls (to the card) while the buttons never move. A comment on the root says never to add `transform`, `filter`, `will-change` or `contain` to it: any of them would make it the containing block of the fixed grid, which would then scroll with the column.
- **The panic-phone row** (the keep-ready card or the phone-ready line): before the grid at `tall` (as always) and in landscape (where that slot is the end of the status column, after "Send to"); in the below-grid container at `compact` (the panic-short markup).
- **Order:** 3 × 2 fills by row, so Hold / Secure / Lockdown are on top and Fire / Evacuate / Shelter / Medical below: the SRP reading order. DOM, visual and focus order agree (asserted). `land2x3` keeps the portrait pairs.

## Sizes, measured in Chromium (smallest diameter over the six; every after-value round, |w − h| = 0.00)

Before = this branch's spec against a production build of the unfixed page (`d0e02c205`); after = against this branch. Both with the keep-ready card and the live-alert line.

| Viewport | Before | After | Shape |
|---|---|---|---|
| 667 × 375 | 2.00 | 107.66 | 2 × 3 |
| 740 × 360 | 2.00 | 113.33 | 3 × 2 |
| 844 × 390 | 2.00 | 148.00 | 3 × 2 |
| 915 × 412 | 5.36 | 156.00 | 3 × 2 |
| 932 × 430 | 11.36 | 156.00 | 3 × 2 |
| 750 × 340 (a 390 × 844 iPhone in Safari, bars showing) | 2.00 | 116.66 | 3 × 2 |
| 734 × 343 | 2.00 | 111.33 | 3 × 2 |
| 712 × 325 | 2.00 | 104.00 | 3 × 2 |
| 568 × 320 | 2.00 | 89.33 | 2 × 3 |
| 658 × 320 | 2.00 | 89.33 | 2 × 3 |
| 699 × 390 / 700 × 390 | 2.00 / (not run) | 112.66 / 100.00 | 2 × 3 / 3 × 2 |
| 844 × 540 / 844 × 541 | 48.03 (not round) / (not run) | 148.00 / 108.25 | 3 × 2 / compact |
| 390 × 799 | 134.36 | 111.33 | compact |
| 390 × 800 | 110.03 | 110.03 (unchanged: `tall`) | tall |
| 390 × 750 | 118.03 | 111.33 | compact |
| 390 × 700 | 101.36 | 111.33 | compact |
| 390 × 664 | 89.36 | 111.33 | compact |
| 390 × 600 | 68.03 (not round) | 111.33 | compact |
| 390 × 560 | 54.70 (not round) | 111.33 | compact |
| 390 × 548 (an SE-class phone in Safari) | 50.70 (not round) | 111.33 | compact |
| 375 × 548 | 50.70 (not round) | 106.33 | compact |
| 360 × 640 | 81.36 | 101.33 | compact |
| es, 844 × 390, Voice on | 2.00 | 148.00 | 3 × 2 |
| es, 667 × 375, Voice on | 2.00 | 107.66 | 2 × 3 |
| es, 390 × 548 | 45.20 (not round) | **103.50** | compact |
| zh, 844 × 390 / 667 × 375 / 390 × 548 | 2.00 / 2.00 / 50.70 | 148.00 / 107.66 / 111.33 | |

Every en and zh after-value equals the class-geometry calculation, to within 0.01 px (`landscape 3 across: min(156, (W − S − 60) / 3, (H − 36) / 2)`, `2 across: min(156, (W − S − 44) / 2, (H − 52) / 3)`, `S = clamp(340, 0.4 W, 400)`; `portrait 3 across: min(156, (W − 56) / 3, (H − stack − 28) / 2)`, with the stack 296.5 px with the alert line). es at 390 × 548 is row-bound at 103.5: its longer copy makes the stack about 16.5 px taller than en's (the design estimated about 96 px for es at 375 × 548; that size was not run). In landscape the size does not depend on the alert line, the sign-in check line, DRILL, the language, the card or a set-up phone's ready line: all of those are asserted not to move the buttons by half a pixel.

### Where 88 px cannot be met (calculated from the same geometry; not run as tests)

- **Landscape:** 640 × 280 (a 360 × 640-class Android with Chrome's bar showing) gets 80 px, round, in en; the 340 px status column is the limit. In general 2 × 3 needs a height of at least 316 px for 88 px (round needs about 290) and 3 × 2 needs a width of at least 664 px (round needs about 638).
- **Portrait, 390 or 375 wide, en, with the alert line:** 88 px holds down to 500.5 px tall and round holds down to 483 (without the alert line: 446.5 / 429). While the transient sign-in check line shows, 88 px holds down to 529. 390 × 480 gives 77.8 (not round). 320-wide portrait is capped by its width at 88.0; 320 × 460 gives 67.8.
- **es with the sign-in check line at 548 tall:** about 82, estimated.

### Trade-offs for the owner

- **390 × 750–799 gets 111 px buttons instead of panic-short's 118–134**, because under 800 px the grid is three across. In exchange the size does not change when a transient line (sign-in check, unreachable) shows, and the shape does not flip between Safari's 664 and 750 px viewports on the same phone.
- **The status column is narrower in landscape:** the identity chip shows about 7 characters in en, and a chosen target's label has about 117 px. "Lobby · 1 screen" fits at 844 × 390 and 750 × 340 (asserted), and no header overflows in es or zh with Voice on (asserted), so the planned fallback (raise the column minimum to 360 px, about 6.7 px off each button at 700–850 wide) was **not needed**.
- **In landscape the card is one scroll away** below "Send to" at most heights; LIVE | DRILL, the alert line and "Send to" are fully in view with no scroll at every size listed above with "status column" in the tests (667 × 375, 740 × 360, 844 × 390, 915 × 412, 932 × 430, 750 × 340, 734 × 343).
- **Before hydration** a landscape phone shows the `tall` stack (inert, as on panic-short); after hydration the buttons' size cap changes and their own `transition-all duration-150` animates it for 150 ms.

## A rotation never remounts a pressed button

Every shape change is a class or style change on the existing root, header, sign-in line, title, controls, grid and buttons. The grid keeps its slot and its six `key={type.id}` buttons; the single-string hook gives one React commit per media change.

| Transition | What remounts |
|---|---|
| `tall` ↔ landscape (390 × 844 turned to 844 × 390) | nothing; the phone row stays in the before-grid slot |
| `land2x3` ↔ `land3x2` | nothing |
| `compact` ↔ landscape | the phone row only (its state lives in the page) |
| `tall` ↔ `compact` | the phone row only (as on panic-short, already pinned) |

Pointer capture survives a change to `position: fixed`; it ends only when the element leaves the document. A keyboard hold keeps focus, so `onBlur` does not fire. Residual risk: iOS may send `pointercancel` during a physical rotation, which cancels the hold. That is the safe direction; the guarantee is "never sends early", not "the hold survives a rotation".

## Safari

- No `vh`, `dvh` or `svh`. Heights come from the fixed root and the grid's rows; widths use `vw` only, inside the caps. With overlay scrollbars `100vw` equals the root's width.
- `min()`, `max()` and `calc()` with `var()` and `env()`: Safari 13.1 and later. `aspect-ratio`: Safari 15, already relied on.
- The page sets no `viewport-fit=cover`, so iOS letterboxes landscape and the left/right `env()` insets are 0; the `max()` floors apply. In the installed app the bottom inset is absorbed by `pb-[max(0.75rem,env(safe-area-inset-bottom))]`.
- A fixed grid inside the fixed, `overflow-y-auto` root works in Chromium (measured). **Not verified in WebKit locally**: the CI WebKit shard and a real iPhone are the gates. Failure direction if iOS ever scrolled the grid with the status column: the buttons move by at most the column's overflow (about 100 px), the same trade panic-short accepts in portrait, and they stay hit-testable.
- The overlays (target picker `z-[120]`, alerts sheet `z-[110]`) still paint above the grid, which has no z-index.
- Desktop only: in landscape windows 540 px tall or less, the root's classic scrollbar sits under the grid; wheel scrolling over the status column still works (the scroll test uses the wheel).

## Tests

None loosened, skipped or quarantined; every existing test stays.

**Jest**, `apps/web/src/app/panic/__tests__/panic-page.test.tsx`, new block 8 (block 7 unchanged: its `matchMedia` mock answers unknown queries false, so it now reads `compact`, and all five of its tests pass):

- 8.1 `tall`: the root, header, sign-in line, title block, h1, hint, controls, grid and every button carry exactly the panic-short class strings; the grid has no `style` attribute; the card is before the grid.
- 8.2 `compact`: three across, the column cap, the dense stack; the card (and, as a set-up phone, the ready line with Turn off) in `panic-phone-row-below` after all six buttons; the set of visible test ids, roles, labels and text equals `tall`'s, with the sign-in check line and after.
- 8.3 `land3x2` and `land2x3`: the root's `--panic-status-w` and `paddingRight`, the fixed grid with the right columns, no `inset` utility; the card after "Send to" and before the buttons; no below-grid container; the visible set equals `tall`'s.
- 8.4 a keyboard hold on Lockdown flipping every 400 ms through `tall` → `land3x2` → `compact` → `land2x3` → `land3x2` → `tall`: all six buttons are the same nodes at every step; a key-up at 2.4 s sends nothing; a second hold across the same flips, kept past 3 s, sends exactly once with the lockdown / live / all-screens arguments.
- 8.5 DRILL chosen, then a rotation mid-hold: the buttons keep the drill labels and the completed hold sends a drill.
- 8.6 `usePanicLayout`: the three queries are classic syntax; all eight query combinations map to their shape and changes are followed; the server render is `'tall'` whatever the client matches; all three listeners are added and removed; the `addListener` fallback works.

Negative control (not committed): with `key={layout}` on the grid, 8.4 fails at the node-identity check, and so does block 7's mid-hold test.

One-off (not committed): with no `matchMedia` (so `'tall'`), `container.innerHTML` of this page and of the panic-short page (`d0e02c205`) are byte-identical for a signed-in admin with the card and a live alert (17,403 bytes) and for a set-up phone (17,311 bytes).

**E2E**, `apps/web/tests/e2e/emergency-targeting.spec.ts`, new describe "/panic — phone landscape and short portrait screens" (36 tests), plus one tightening of an existing test:

- Landscape matrix (667 × 375, 740 × 360, 844 × 390, 915 × 412, 932 × 430, 750 × 340, 734 × 343, 712 × 325, 568 × 320, 658 × 320), an unenrolled admin with the card and the alert line: six buttons of at least 88 px, round (|w − h| < 2), inside the viewport on both axes and apart; the size within 1 px of the table; two or three rows; the arrangement by aria-label and reading order equal to DOM order. At the seven status sizes: no scroll, LIVE | DRILL, the alert line and "Send to" fully in view, every status element's right edge at least 8 px left of the leftmost button, no header overflow and no sideways page scroll.
- 844 × 390 and 667 × 375: identical button boxes while the sign-in check line is held open, after sign-in, after "Not now", in DRILL and with no alert line. 844 × 390 as a set-up phone: the same boxes; the ready line and Turn off one scroll away.
- 750 × 340 scrolled to the end of the status column (mouse wheel): the card fully in view, `scrollTop` above 0, the button boxes identical; a 1.2 s press sends nothing and the full hold sends exactly the pre-targeting arguments.
- Rotation mid-hold, 390 × 844 → 844 × 390 and 390 × 664 → 750 × 340: the stashed Lockdown node is still the same connected node; a release at 1.5 s sends nothing; a hold to 3.4 s sends exactly once.
- Compact matrix (390 × 799, 750, 700, 664, 600, 560, 548; 375 × 548; 360 × 640) with the card and the alert line: round, at least the table's size minus 1; the card starts at or below the bottom row; identical boxes after "Not now".
- Boundaries 390 × 799 | 800, 844 × 540 | 541, 699 × 390 | 700 × 390: six round buttons of at least 88 px either side.
- es and zh (`venueos_locale` cookie) at 844 × 390 and 667 × 375 with Voice on, and at 390 × 548: no header overflow, no sideways scroll, nothing in the status column past the grid's edge, round, at least 88.
- "Lobby" chosen at 844 × 390 and 750 × 340: the target label is not truncated and "Send to" is fully in view.
- **Tightened:** the existing 390 × 560 test now also asserts round and at least 88 px, with the card and after "Not now" (its comment explained why it could not before).

Two test-mechanics findings from the first green-path run, fixed in the spec, not in the page:

1. **Hydration transition.** The server renders the `tall` shape; the first client render changes the buttons' size cap, and their own `transition-all duration-150` animates it. A box read inside those 150 ms is neither size (844 × 390 read 150.4 × 148 there, which failed "the same boxes" by 1.2 px and once made the set-up phone test flaky). Both box helpers (`triggerBoxes`, `namedTriggerBoxes`) now first wait until none of the six buttons has a running animation (`getAnimations()`); nothing on a button runs forever, so a button that never settles fails the poll.
2. **`scrollIntoViewIfNeeded` and whole-pixel scrolling.** At 750 × 340 it lines the card's bottom up with the screen's, and Chromium's integer scroll offset (59 for 59.48) left the card 0.48 px short of fully in view (ratio 0.9945 on every retry). The test now scrolls the status column to its end with the mouse wheel, as a person does; there the card has 3.5 px to spare, and the assertion is still `toBeInViewport({ ratio: 1 })`.

## Verification record

All local, on a 4-CPU / 16 GB container, every heavy command alone through the machine's lock wrapper, against a production build (`next build` with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`, served by `tests/e2e-webserver.cjs` with `CI=true E2E_PREBUILT=1`). Chromium is the preinstalled headless shell build 1243 (the repo's Playwright wants 1217), through a wrapper config outside the repository.

| Gate | Result |
|---|---|
| **Red first:** the new describe plus the tightened 390 × 560 test against a build of the unfixed page (`d0e02c205`), no retries | 34 failed, 3 passed (33 of the 36 new tests, plus the tightened 390 × 560 test). The three that pass on the unfixed page are 390 × 799, 390 × 750 and the 390 × 799 / 800 boundary, which already had room. Sizes in the table above. |
| Web production build (`pnpm --filter web build`) | pass, exit 0; the built CSS has every new utility (`max-h-[var(--panic-btn-max)]`, the dense `pt-` / `pb-` / `pr-` `max(…, env())` values, `space-y-1.5`, `mt-0.5`), and the `/panic` client chunk has `max-h-[var(--panic-btn-max)]` |
| Web typecheck (`pnpm --filter web exec tsc --noEmit`; the tsconfig includes `tests/e2e`), on the final tree | pass, exit 0 |
| Jest, `panic-page.test.tsx` | 33 of 33 (21 existing, 12 new) |
| `pnpm lockfile drift` (`pnpm install --frozen-lockfile --lockfile-only`, then `git diff --exit-code pnpm-lock.yaml`) | pass, unchanged |
| `check-bundle-budget.cjs` | pass: 2,181 chunks, 20.16 MB, within the ceiling |
| Web jest, full suite (`--ci --maxWorkers=2`) | pass: 724 of 724 suites, 10,728 of 10,728 tests (`panic-page.test.tsx` re-run alone on the final tree: 33 of 33) |
| `check-i18n-parity` | pass: 7,691 keys in en, es and zh (no new string) |
| `pnpm mobile-perf-guard` | pass |
| `check-inset-serialization` | pass: 0 confirmed landmines |
| `check-request-budget` (and `--self-test`) | pass (no new network call) |
| `check-pill-rules` | pass: 58 legacy, none above baseline |
| `scripts/check-rulebook.cjs` (and `--self-test`) | pass |
| ESLint on the changed files | the new hook and the constant file are clean; the page, the jest file and the spec have the same findings, by rule and count, as the panic-short versions (all pre-existing) |
| Chromium e2e, `emergency-targeting.spec.ts` alone, no retries, after the two spec fixes | **44 passed, 0 failed** |
| Chromium e2e on the final tree, `emergency-targeting.spec.ts` plus the `emergency-path.yml` list (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`), one run, `--workers=1`, CI retries | **84 passed, 1 skipped, 0 failed, 0 flaky**; all 44 targeting tests passed on the first try. The skip is the existing Chromium quarantine in `emergency-drill-paint-proof.spec.ts` |
| WebKit, every spec | **not run here** (not installed): unverified locally; CI is its gate (the general E2E WebKit shard runs `emergency-targeting.spec.ts`) |

## Proposal (not implemented, again): make the panic layout spec a required check

Re-proposed from `docs/handoffs/2026-11-23-panic-short-screen.md`. A CI definition change is consequential (`AGENTS.md`) and needs the owner's written go, so this branch does not make it.

- **Situation.** `emergency-targeting.spec.ts` now holds the `/panic` trigger's geometry in landscape and short portrait as well as its hold contract, and it still runs only in the general E2E shards, which are not required. It went red for a week on `master` once already.
- **Evidence.** The 2026-11-16 release train merged with this spec red; landscape was broken (2 px buttons) with no spec at all until this branch.
- **Recommendation.** Add `tests/e2e/emergency-targeting.spec.ts` to the `Run emergency-path E2E` step's file list in `.github/workflows/emergency-path.yml` (both matrix browsers). The job names the ruleset requires do not change.
- **Risk.** The spec now has 44 tests (about 80 s of test time in Chromium here); a flaky one would block merges. It ran green with no retries here; CI retries are 2.
- **Validation.** One PR run of both Emergency Path jobs green; one deliberate red (this branch's spec against the unfixed page) red.
- **Rollback.** Remove the path from the step.
- **Decision.** Owner.

## Unverified, and left alone

- **On glass (the owner):** an iPhone in Safari landscape (750 × 340-class) and as the installed app; an SE-class phone in portrait Safari (about 548 px tall); an Android in Chrome landscape (293–360 px tall). On each: six round buttons with no scroll; a hold takes 3 seconds; rotating mid-hold never sends early; the buttons stay still while the status column momentum-scrolls; a press during rubber-banding behaves acceptably.
- **WebKit**, locally: the fixed grid inside the fixed, scrolling root is the one piece of this layout Chromium alone cannot vouch for.
- **Follow-up, pre-existing, out of scope:** the "Broadcasted" screen clips at about 340 px tall in landscape.
