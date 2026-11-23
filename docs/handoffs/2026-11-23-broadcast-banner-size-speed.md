# Broadcast banner: text size and a slower marquee (2026-11-23)

**Status.** Branch `claude/broadcast-banner-size-speed`, cut from `origin/master` `1292fd287`. Two code commits (`731e5ba7e` the feature, `52f031428` the review-round-1 fix), this document, and a test-only commit (`ee80e0daa`, the speed measurement). Not merged, not pushed. This is life-safety **CHANGE class** (`CLAUDE.md` §5: a pushed broadcast and a district copy are part of the alert path). Before anyone relies on it, it needs:
- the owner's written go to merge;
- CI green on the nine required checks, including `webkit · Emergency path`, which nobody could run in this sandbox;
- the on-glass bench drill below, after deploy. That drill is the owner's call.

The different-vendor review was **waived by the owner in writing** ("Don't worry about another model review"). The review that did run was same-vendor.

**Who wrote it.** Claude Opus 5.5 built it, with workflow-orchestrated agents, in Claude Code on the web. Fable 5.2 reviewed it in two rounds. Round 1 asked for changes: a Large static message could be clipped. Round 2 approved.

**The owner's ask:** "On our broadcast option it would be nice to have small medium or large text and the scrolling even on slow is fast, can we update all 3 scrolling section to be more reasonable on the scroll speed".

## What changed

| Area | File | Change |
|---|---|---|
| Shared options | `packages/api-types/src/broadcast-banner.ts` | Slower speed table. `bannerPxPerSecond` and `bannerLoopSeconds` time the marquee by the distance it really travels. `size` is added to `BannerOptions`, `BannerStyleInputSchema` and `sanitizeBannerOptions`. `BANNER_TEXT_SCALE`, `bannerFontPx` and `bannerSizeOf` are new. |
| Player and preview bar | `apps/web/src/components/player/BroadcastBannerBar.tsx` | The font follows the size. Static text shrinks to fit 2 lines, then keeps shrinking so it is never clipped. The marquee is timed by the distance it travels. New attributes: `data-banner-size`, `data-banner-seconds`. |
| Overlay | `apps/web/src/components/player/EmergencyOverlay.tsx` | The banner re-measures its inset when `size` changes. The 40% height cap is unchanged. |
| Composer | `apps/web/src/app/[schoolId]/emergency/broadcast/page.tsx` | A Small / Medium / Large radio group next to Static/Scrolling and Speed, with the same styling, 44 px targets, `role="radio"` and keyboard access. The preview uses it. A one-time resend covers the deploy-order case (see Compatibility). |
| Composer helpers | `apps/web/src/lib/broadcast-banner.ts` | `bannerForSend(hex, mode, speed, size)` sends `size` only for small or large. New: `refusedOnlyBannerSize`, `bannerWithoutSize`. |
| Strings | `apps/web/src/i18n/messages/{en,es,zh}.json` | `textSize`, `sizeSmall`, `sizeMedium`, `sizeLarge` (Text size / Small / Medium / Large; Tamaño del texto / Pequeño / Mediano / Grande; 文字大小 / 小 / 中 / 大). |
| Tests | see Validation | api-types, bar, composer, lib, pushed-message and API specs; two e2e specs. |

**What did not change.** No file under `apps/api/src` changed except `apps/api/src/emergency/emergency.broadcast-banner.spec.ts`. These are untouched: the HMAC gate, the polling backstop, the audit rows, the CRITICAL full-screen alert and the lockdown-class overrides. CRITICAL still drops the banner from the row, the push and the poll, and a spec pins that. There is no schema change (`bannerStyle` is Json) and no new environment variable.

## Speed

The stored values stay `slow` / `normal` / `fast`, so stored messages and older players stay valid. The new "fast" is the old "slow".

| Speed | Old: stage widths/min | Old: s per screen width | Old px/s at 1920 / 3840 | New: stage widths/min | New: s per screen width | New px/s at 1920 / 3840 |
|---|---|---|---|---|---|---|
| slow | 3 | 20 | 96 / 192 | 1.25 | 48 | 40 / 80 |
| normal | 5 | 12 | 160 / 320 | 2 | 30 | 64 / 128 |
| fast | 8 | 7.5 | 256 / 512 | 3 | 20 | 96 / 192 |

**A second bug, also fixed.** The old bar timed one loop by one copy of the text, but the track slides half its copies per loop. So a short message moved 2x or 3x the table speed. On the shipped component at "slow" on a 1920 stage, a long message moved at 96 px/s, a ~60-character message at 192 px/s and a ~25-character message at 290 px/s. That is a large part of why "even slow is fast". `bannerLoopSeconds` now times the distance actually travelled, so every message length moves at the table speed.

**Minimum loop time.** It stays 4 s (`BANNER_MIN_LOOP_SECONDS`). A loop is always at least as wide as the bar, so the floor never applies on a real stage. It can only slow a degenerate case down. A short message cannot whip by.

**A message already on screen** picks up the new speed when it is next rendered.

## Text size

`size` is `small` / `medium` / `large`. **Medium is the absence of the key.** Its factors are exactly the ones every banner with options has drawn since 2026-11-01. Small and Large scale Medium's factors, clamps included.

| Size | Font (fraction of stage width, clamp) | Static shrink floor (fraction, clamp) | px at 1280 / 1920 / 3840 (font / floor) |
|---|---|---|---|
| small | 0.017, 16-92 px | 0.0089, 12-46 px | 22/12 · 33/17 · 65/34 |
| medium | 0.022, 20-120 px | 0.0115, 14-60 px | 28/15 · 42/22 · 84/44 |
| large | 0.030, 27-164 px | 0.0157, 19-82 px | 38/20 · 58/30 · 115/60 |

**Static text.** Text starts at the size's font. While it needs more than 2 lines, it shrinks in 2 px steps down to the size's floor. The overlay caps the bar at 40% of the canvas. If the text is still taller than the room the capped bar gives it, it keeps shrinking in 1 px steps, past its own floor, down to Small's floor. So no size ever shows less of a message than Medium does.

This is the round-1 fix. Before it, Large at its own floor overflowed the cap from about 1,300 characters on a 1920 stage. The bar centres its text with overflow hidden, so it cut lines off the **top and bottom equally**. At 2,000 characters about 3 lines were lost at each end.

**Measured on the real player in Chromium at this head.** The source is the `BANNER-CLIP` / `BANNER-MEASURE` output of `apps/web/tests/e2e/broadcast-banner-style.spec.ts`. The round-2 review measured these, and the run for this handoff reproduced every bar height exactly.

Maximum bar height, for a 2,000-character static message (the API maximum):

| Stage | Small | Medium | Large | Cap (40%) |
|---|---|---|---|---|
| 1280x720 | 186 | 280 | 280 | 288 |
| 1920x1080 | 227 | 366 | 426 | 432 |
| 3840x2160 | 419 | 696 | 832 | 864 |

- No line is cut at any size, up to 2,000 characters, on any of the three stages: `cutTop` and `cutBottom` are 0 in all 27 cases.
- At 2,000 characters, Large shrinks to 24 px at 1920 (Medium: 22 px). At 1280 it shrinks to Medium's 15 px.
- A 2-line static bar (a ~130-character message) is 119 / 141 / 171 px at 1920 (Small / Medium / Large; 11% / 13% / 16% of the height). At 3840 it is 199 / 246 / 319 px (9% / 11% / 15%).
- **The 2-line promise at Large holds to about 230 characters.** Beyond that, Large wraps to more lines. At 400 characters on 1920: Small 2 lines, Medium 3, Large 4 lines in a 186 px bar (17% of the screen). A 300-character message is 3 lines at Large on 1280, 1920 and 3840.
- **Scrolling** is one line at the full font. The bar is 77 / 89 / 109 px at 1920 and 117 / 141 / 180 px at 3840.
- **Measured speed.** A short message (6 copies, the case that used to run 2-3x) moves at exactly 40 / 64 / 96 px/s at 1920 and 80 / 128 / 192 px/s at 3840 (slow / normal / fast), measured on the animation's own clock (`ee80e0daa`; 6 of 6 runs under parallel load). An earlier wall-clock window read 73 at 3840 slow and once failed under load; that measurement is fixed, see follow-up 1.

**Sanitising.** The key order is fixed: color, mode, speed, size. `size` appears only for small or large. An unknown or hostile size is treated as medium.

What counts as a request:
- An explicit valid size on its own, medium included, is a request. It means the stage-relative static bar at that size. `null` ("today's look") is the fixed 20 px legacy text, and answering `{ size: 'medium' }` with it would draw text smaller than Small.
- An unknown size on its own is not a request, so it stays `null`.
- A speed on its own is not a request either, as before.

The strict schema still refuses unknown keys and unknown size values.

## Compatibility

- **Stored messages and Medium sends are byte for byte unchanged.** This covers the row, the signed push payload, the poll answer and the paint identity, because Medium carries no `size` key.
- **An older player given a Small or Large message shows Medium.** Its sanitiser copies only colour, mode and speed, and it ignores the key it does not know. It also keeps its own, faster, speed behaviour until it loads the new web bundle.
- **A newer player given an older message shows Medium.**
- **Delivery.** `size` travels through `sanitizeBannerOptions` on every route a banner takes: a tenant send, every district copy (one row, one push and one poll answer per school), a group send, a hand-picked set of screens, and the device poll `GET /emergency/messages`. API specs pin each route.
- **Deploy order.** Vercel can serve the new composer before Railway serves the new API. During that window the old API's strict schema refuses a Small or Large `size` with a 400 from the validation pipe, before the handler runs, so nothing is written or sent. The composer recognises exactly that refusal and resends **once** without `size`, so the broadcast goes out at Medium instead of not at all. The match is in `refusedOnlyBannerSize`: every issue must have path `banner` and code `unrecognized_keys`, and the only key named must be `size`. Medium sends never take this path. Any other 400 is shown to the sender as before. The sender is not told about the downgrade; there is only a console warning. **The Lead should confirm `/api/v1/health` reports the merge commit before anyone relies on Small or Large.**

## Taurus (Chromium 83)

- No `inset` shorthand, no flex `gap`, and no 4-side style object (`apps/web/tools/check-inset-serialization.cjs` is clean).
- The animation is transform-only (`translate3d`).
- `ml-4` stands in for a gap.
- Not verified on Taurus hardware; see the drill.

## Validation (run at head `52f031428` plus this document)

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile --lockfile-only` (lockfile drift) | pass |
| `prisma generate`, workspace packages build (api-types first), `pnpm --filter api build` | pass |
| `pnpm --filter @cms/api-types test` | 30 suites / 525 passed |
| API jest `src/emergency src/realtime src/tenant-isolation` | 59 suites / 1,821 passed |
| web `tsc --noEmit` | pass |
| web production build (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`), then `check-bundle-budget.cjs` | pass; within the ratcheted ceiling |
| web jest, full suite (`--ci --maxWorkers=3`) | 713 suites / 10,506 passed |
| Emergency-path Chromium e2e: the five specs in `.github/workflows/emergency-path.yml`, prebuilt server, `CI=true` | 40 passed, 1 skipped, 0 flaky. The skip is the pre-existing Chromium quarantine in `emergency-drill-paint-proof.spec.ts` ("NO cached alert holds black"). |
| `broadcast-banner-style.spec.ts` and `broadcast-composer.spec.ts`, Chromium | 12 passed |
| `check-i18n-parity` (7,668 keys), `check-inset-serialization`, `check-taurus-safety` and the rest of `taurus-safety.yml`'s scripts, `pnpm mobile-perf-guard`, `check-pill-rules`, `check-tenant-isolation`, `check-rulebook`, `check-schema-has-migration` (`BASE_SHA=1292fd287`) | all pass |

**Not run here.**
- **WebKit.** It is not installed in this sandbox, so CI's `webkit · Emergency path` and the cross-browser jobs are the first WebKit run.
- **The pinned Chromium build.** The repo pins Playwright Chromium build 1217. This sandbox has 1243 preinstalled, and Chromium runs used it through an uncommitted scratch config. CI on the pinned build remains the gate.

## Follow-ups (not blocking, from review round 2)

1. **Fixed: a flaky e2e measurement.** `text size, bar height and real scroll speed on a 3840x2160 stage` timed a 2 s wall-clock window with `performance.now()`, which runs ahead of the last painted frame; it failed once in a loaded parallel run (60.6 px/s against a floor of 64). `ee80e0daa` reads position and time from the same clock (the animation's `currentTime`); same assertions, same 20% band, 6 of 6 runs at three workers read the expected speeds exactly.
2. **The never-clip pass can miss a cap change.** It re-runs only when the text, font or floor changes. If an LED canvas height override changes mid-message while the stage width stays the same, a very long Large message keeps the font fitted to the old cap until the next re-render. This needs more than about 1,300 characters at Large. A fix is a ResizeObserver on the bar, or passing the cap in as a prop.
3. **The silent downgrade.** During the deploy-order window a Large or Small send goes out at Medium with only a console warning. A small note in the sent state would tell the sender.
4. **Labels.** The speed label stays "Normal" next to the new size label "Medium" (the stored value is `normal`). That is one reading of the owner's word "medium"; the owner can choose to rename it.

## Bench drill (owner-approved, after deploy; never a live alert)

Use a **test tenant** and a **paired bench screen**. Send INFO broadcasts only, never WARN-as-live, CRITICAL or a lockdown-class trigger.

1. Confirm `/api/v1/health` reports `commit` equal to the merge SHA, so Small and Large are not downgraded by the deploy-order path.
2. Static, once at each size (Small, Medium, Large): a one-line message, then a ~200-character message. Check from viewing distance that it is readable and that the bar stays a reasonable band at the bottom.
3. Static, Large, 2,000 characters starting with START and ending with END. Check that both words are on the glass and the bar stays within 40% of the screen.
4. Scrolling, once at each speed (Slow, Normal, Fast), at Medium: a short message ("Early dismissal at 1 pm") and a long one. Slow should take about 48 s to cross the screen, Normal about 30 s and Fast about 20 s, the same for both lengths.
5. Scrolling, Large, Slow, a long message (several hundred characters) on the Chromium 83 Taurus bench controller. Check that it moves smoothly and does not stall.
6. Clear each message. Check that the banner leaves the glass and normal content returns.
7. Optional: open one message on a screen still running an older player build and confirm it shows Medium.

## Rollback

Revert the PR, or redeploy the previous web and API builds. There is no migration.
- A message stored with `size` stays valid: the previous API re-sanitises it away and the previous player ignores it.
- The previous speeds return with the previous web bundle.

There is no kill switch. This is a sender's display choice, not an autonomous behaviour. Its failure direction is Medium: an unknown, missing or refused size draws Medium, and static text shrinks rather than lose a line.
