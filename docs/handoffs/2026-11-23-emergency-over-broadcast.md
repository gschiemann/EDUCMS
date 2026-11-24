# An emergency takeover outranks a broadcast banner; its all-clear restores the content and the banner (2026-11-23)

**Status.** Branch `claude/emergency-over-broadcast`, cut from `origin/master` `31ebf86e7`, up to date with `origin/master` `cb0b052c1`. Commits, oldest first:

| Commit | What |
|---|---|
| `29febf4d8` | The fix (web player, APK, kill switch, e2e 8e–8h) |
| `f2b5987ca` | Review round 1: the alert-watch wiring pin, the banner-support note from every `sharedVideoState` reply, the posture check after a promotion, e2e 8i |
| `1d3b0811c` | Merge of `origin/master` `cb0b052c1` (#354, #355, #358; one conflict, `CHANGELOG.md`, both entries kept) |
| `57519f116` | Handoff after round 1 (approved in round 2) |
| `40a42483d` | Round 2 should-fix, **after the round-2 approval and not seen by that reviewer**: the pending "EMERGENCY" words follow the tenant alert, not the message class (see "Review") |
| `7118e647d` | The same fix as an e2e check: two added assertions in 8i (red on the approved head, green here) |
| `8867e9fc1` | This handoff, moved to the 2026-11-23 name (the day of the demo) with its two references |
| this commit | Review round 3 (the two commits above): approved; its should-fix 1 as a parsed source pin in `emergencySurface.test.ts` |

Not pushed, no PR, not merged, not deployed. **CI has not run on any of it**: `player-kotlin-check.yml` (`testDebugUnitTest` + `lintDebug`) and both Emergency path jobs (WebKit included, which nobody has run) must be green on the PR before anything is called ready. Everything said about a real screen is **unverified** until the owner's bench drill.

- **The owner's words (2026-11-23, after a live demo):** "in my demo today I pushed a broadcast, then pushed an emergency drill but it left the banner up, then when I stopped the emergency the web url on the l55vec screen never came back until I killed the broadcast … emergency alert o strides everything and canceling needs to bring back original content including the broadcast".
- **Life-safety CHANGE class** (`CLAUDE.md` §5). The owner waived the different-vendor review in writing ("Don't worry about another model review"); the review was same-vendor. The waiver covers the review only. The on-glass drill on a bench L55VEC, in a test tenant, drill only, stays the owner's.
- **Two layers, two ways to reach a screen.**
  - **Web player** (`apps/web`): ships with the web deploy, and is safe on every APK. It fixes "the banner stayed up over the drill" on every screen.
  - **APK** (`apps/player`): reaches a screen **only through a player release** (`apps/player/CLAUDE.md` rule 9, the hardware qualification gate, and rule 13, the release). **An APK release is needed.** Until it ships, an L55VEC keeps the native website dark after the all-clear for as long as the broadcast lasts. **Workaround until then:** clear the broadcast after the all-clear.
- **Not in this change:** the alert email in UTC instead of the screen's local time (its own track, merged to `master` as #358 and carried here by the merge); which of a pushed SOS / MEDIA_ALERT / CRITICAL text and a tenant lockdown or drill outranks the other (the owner's call: both keep today's draw, so a drill never hides a real SOS).

## Investigation 1: why the product failed

A tenant alert (a manifest OVERRIDE, live or drill) and a pushed TEXT_BROADCAST are separate tiers, and nothing said which one wins. Two layers show it:

1. **The banner over the drill (web player).** `emergencyMessageOverlay` was mounted in every render branch, the takeover branch included. For an INFO or WARN broadcast, `EmergencyOverlay` portalled the banner to `document.body` at z-index 9999; the drill's typed fallback sits at 9998. `decideEmergencySurface` never considered the banner while a tenant alert was up, and with a staged board (`playlist.isEmergency`) the board was even scaled down under the banner (`broadcastContentStyle`). The paint-proof scan certifies the topmost root, so during the drill `PLAYER_EMERGENCY_PAINTED` certified the **banner**, not the drill. The protective pending "EMERGENCY" words were also hidden by any held pushed message, a banner included.
2. **The website dark after the all-clear (APK).** The two share one display hold on the APK, and that hold could move only one way. When the drill arrived the page sent banner geometry `active:false` and the hold as a takeover; `BroadcastBanner.set(0,false)` dropped the insets and the holder, and `BroadcastContentViews.apply` made the native site view INVISIBLE. At the all-clear the live manifest still held because of the broadcast, so the page asked for banner posture again: geometry `active:true`, then `displayEmergencyHold(true, true)`. The APK refused both on purpose (`set`: held with no insets; `hold`: held before and not a banner holder), **silently** (`FaceVideoBox.banner` returned; `sharedVideoState` reported only rotation refusals). The page believed it was in banner posture and posted `showUrlOverlay`; `MainActivity` made the view VISIBLE and `BroadcastContentViews.refresh()` hid it again at once. Only the full release, when the broadcast was cleared, un-masked it: exactly "never came back until I killed the broadcast". The same refusal strands native content after an SOS / MEDIA_ALERT / CRITICAL text pushed over a held banner is cleared.

Which APK the demo L55VEC ran is inferred, not read from telemetry: field builds 1.1.56 to 1.1.67 contain `8a2d8aa88` (2026-10-29, "Preserve native website and positioned video sessions under broadcasts"), which added `BroadcastContentViews`; stable 1.1.29 has neither it nor `BroadcastBanner`.

## Investigation 2: why our system let it reach the owner's demo

1. **No written precedence between the two tiers.** `master`'s `apps/api/src/emergency/CLAUDE.md` had rules for the pushed set (EMG-04), the takeover and the signed fan-out, and nothing on what a tenant alert does to a broadcast banner (`git show origin/master:apps/api/src/emergency/CLAUDE.md | grep -i banner` finds no such rule). Each tier was correct alone; the combination had no owner. This change adds the rule ("An alert outranks a broadcast banner; its all-clear gives the banner back").
2. **The tests covered each tier alone and one cross-tier order.** e2e 8c (EMG-04) pushes an SOS over a held INFO banner on the page. No test ran "banner, then tenant alert, then the all-clear with the broadcast still up", which is the demo's order. The new 8e–8i do.
3. **A unit test pinned the defect as intended behaviour.** `BroadcastBannerTest.bannerCannotDowngradeAnExistingTakeover` and `takeoverOrNewDocumentRestoresPlaybackSuppression` pinned "a banner cannot downgrade a takeover" with no exit for the legitimate case (the takeover ended, the broadcast remains). The rule was deliberate and safe in one direction; nothing tested the other.
4. **No e2e can see the APK.** The web e2e records what the page posts to a fake native channel. The mask lives in `BroadcastContentViews`, which only a device shows. The stack had no layer that runs the page against the real APK's hold logic.
5. **The refusal was silent and the receipt certified the wrong thing.** The APK wrote no log line and reported nothing when it refused banner posture, and during the drill the paint receipt certified the banner. Neither telemetry nor the render-proof lane could have flagged the screen. This change adds `PLAYER_TAKEOVER_ENDED` / `PLAYER_TAKEOVER_KEPT` lines and the `broadcastBannerPosture: takeover-kept` report, and the receipt now certifies the drill.
6. **The field build reached the demo screen without a hardware-qualification PASS.** `maxhub-l55vec-a13` is a REQUIRED class that has never had a PASS (`apps/player/HARDWARE-QUALIFICATION.md`; every release so far shipped on an override, the Phase 1 gap in `CLAUDE.md` §7). And the qualification checklist's load-bearing row (`docs/player/HARDWARE-QUAL-CHECKLIST.md` §6, `emergency-drill`) triggers a lockdown and an all-clear on an idle screen: it has **no step with a broadcast held across the drill**, so even a PASS would not have caught this. The drill design (#198) names pushed broadcasts as part of the alert path; it is not built yet. **Proposal (not made here):** add to the `emergency-drill` row "push an INFO broadcast first; the drill must cover it; after the all-clear the content and the banner come back while the broadcast is still up; then clear the broadcast".

## What changed

### Web player (ships with the web deploy)

| | Before | Now |
|---|---|---|
| An INFO / WARN banner while a tenant alert is up (manifest alert, signed OVERRIDE being confirmed, staged emergency board) | Drawn over the alert at z 9999; the staged board was inset under it | Held but not drawn, in either presentation (also the full-screen form the page uses when the app refused banner posture, which used to cover the drill completely); its layout is withdrawn, so nothing is inset (`emergencySurface.ts` `tenantAlertOnGlass` / `drawnPushedMessage`, `EmergencyOverlay` `suppressBanner`) |
| The pushed set, the 12 s reconcile, the overlay poll | | Untouched. The banner comes back by itself at the all-clear |
| The paint receipt during the drill | Certified the banner (the topmost root) | Certifies the drill: the banner root is not drawn, and the expected identity follows what is drawn |
| The protective pending "EMERGENCY" words while an OVERRIDE awaits its manifest | Hidden by any held pushed message, a banner included | Under a tenant alert, hidden only by a full-screen pushed message. With no tenant alert, a banner-class message hides them as before (`pendingTextHiddenBy(pushed, tenantAlert)`, round 2) |
| After the all-clear, with the broadcast still up, on our app | The page sent `displayEmergencyHold(true, true)`; the APK refused it | The manifest handler's LIVE answers (the 200 apply when not from cache, the live 304, the unconfirmed-OVERRIDE timeout) send `displayEmergencyHold(true, true, true)` on every banner-posture raise: "the takeover ended, only the banner remains" (`emergencyHold.ts` `liveManifestHold` / `openLiveManifestHold`, a scope around the one hold call, so every hold statement keeps the exact text the wiring tests pin). Never a cached manifest, a push, a clear, a reconcile, an effect or the paint reassert. The legacy transport still gets one boolean (`legacyArgs`) |
| Website Tabs bounds under a banner | `getBoundingClientRect()` (already scaled and moved by the page), which an app with `BroadcastContentViews` then transformed again: shrunk and shifted twice | On such an app, canvas coordinates (`broadcastLayout.ts` `nativeSiteViewRect` → `canvasRectFromGlass`, the inverse of the one formula the page's style uses). On any other app the glass rectangle, as before (see the next section). The app's answer is read from every `sharedVideoState` reply the page already makes (boot discovery, the native-first face's read, the paint monitor's read while an emergency root is up), so a late boot read no longer leaves a field build with the double transform |
| The app reports it KEPT the takeover (`broadcastBannerPosture.posture: 'takeover-kept'`) | (no such state) | Read like a refusal: full broadcast presentation, playback held, no native site claimed ready |

Why "every live banner raise" and not "only the flip" (the skeptic's amendment 1): in the SOS-over-banner sequence the flip back to banner posture happens on the push path (`commitPushedMessages('clear')`), so the next manifest never flips, and a page reloaded under a persisted hold has no memory of the takeover the APK still holds. The APK applies the argument idempotently and only behind its own guards.

### One deliberate departure from the plan: Website Tabs bounds depend on the app

The plan (A6) said to post the Website Tabs site area in canvas coordinates. That is right only on an app that applies the banner transform to the site view itself (`BroadcastContentViews`, `8a2d8aa88`, in the field builds). **Stable player 1.1.29 has Website Tabs and no `BroadcastContentViews`** (`git merge-base --is-ancestor 53acd5624 player-v1.1.29` is true, and false for `8a2d8aa88`), so on it a canvas rectangle would put the native site over the tab bar and a strip of the banner. The page posts canvas coordinates only when the app reports `broadcastBannerVersion` ≥ 1 on its existing `sharedVideoState` reply. That key arrived in `f51896253`, whose direct child is `8a2d8aa88`, and no field build sits between them. In doubt (no reply yet, a browser, an old app) the page posts the glass rectangle, today's behaviour. 8g runs both ways: a field-build channel that answers `sharedVideoState` (canvas rectangle) and 8g-old, a channel that does not (glass rectangle, unchanged).

### APK (reaches a screen only through a player release)

- `media/BroadcastBanner.kt`: the anti-downgrade rule stays for every implicit path; geometry alone still never downgrades a takeover, and both `BroadcastBannerTest` cases that pin it are unchanged and green. Its one exit is `hold(…, takeoverEnded = true)`. Geometry refused while held is kept as `pending` (dropped by `clear`, an inactive `set`, a takeover hold and `endHold`). A trusted takeover-ended promotes it and restores the banner holder, unless:
  - the native alert watch raised the hold in this episode (`native-watch`);
  - banner posture was refused on the face at any point in the hold episode (`episodeRefused`, which survives the inactive geometry the page sends when a takeover starts and a document retire: the skeptic's amendment 6);
  - no banner geometry has arrived yet (`no-geometry`, transient, not reported; the next live manifest asks again).
- `display/DisplayEmergency.kt`: records a native-watch raise per hold episode (box-wide), passes `takeoverEnded` only from the page, ends the episode memory on release and on a face's narrow, re-shows a masked site view after a promotion (`BroadcastContentViews.refresh()`), and writes one durable `PLAYER_TAKEOVER_ENDED` line per promotion and one `PLAYER_TAKEOVER_KEPT reason=…` line per newly kept takeover. The display hold itself stays raised until the broadcast ends, so blanking, dimming and wake are unchanged. Since round 1 the posture policy runs again after a promotion, before any native video starts under the banner.
- `display/DisplayControlApi.kt`: `takeoverEnded && bannerOnly && trusted`. `security/NativeBridgeChannel.kt`: a literal `true` third argument routes to `WebAppBridge.displayEmergencyHoldTakeoverEndedViaSecureChannel`; no face from the page. `WebAppBridge.kt`: a new optional host entry; a release or a takeover is the plain hold, and an unwired or throwing entry still sends the plain banner raise (a raise is never lost). `MainActivity.kt` / `face/FacePlayerHost.kt` wire it with their own face.
- `media/SharedVideoHost.kt`: `broadcastBannerPosture: {posture: 'takeover-kept', reason}`, an additive key on an existing value method (no new bridge method).
- D6, `media/BroadcastContentViews.kt` + `MainActivity.kt`: a site view that replaces one whose renderer died while masked inherits the mask, so a release shows it again.

### An existing emergency wiring pin was edited (review round 1)

`alertwatch/NativeAlertWatchWiringTest.kt`, test `the interlock's native door only opens one way`, pinned the page's door into the display hold as the exact text `setHoldFrom(ctx, faceIndex, active, fromPage = true, bannerOnly = bannerOnly)`. This change added `takeoverEnded = takeoverEnded` to that call, so `testDebugUnitTest` would have failed. The pin now names the new call text. Its meaning is kept (the page's entry passes `active` both ways) and it is tightened: the native watch's door (`raiseFromNativeWatch`) must carry no `takeoverEnded`, and the shared body must honour it only from the page (`takeoverEnded = fromPage && takeoverEnded`) while it records a watch raise for the episode. No other existing assertion, web, e2e or Kotlin, was loosened; the other test diffs are additions.

### Kill switch

`EMERGENCY_BANNER_RESTORE_DISABLED` (API, `docs/ENVIRONMENT.md`, generated) → `playback.bannerRestore: 'off'` in the hashed manifest (absent when unset, so no ETag moves). The page then omits the third argument and the app keeps the takeover until the broadcast ends, as before. **Failure direction:** an omitted or ignored third argument (an old APK, the switch, a lost message) leaves the screen a full takeover, today's behaviour. The web half ("an alert outranks a banner") is not switched off by it.

## Review

- **Round 1: changes required.** One must-fix: the `NativeAlertWatchWiringTest` pin above, which the author had not run. Fixed in `f2b5987ca`.
- **Round 2: approved** (`57519f116`). Its should-fix list and what happened to each:

| Round-2 should-fix | Disposition |
|---|---|
| The pending "EMERGENCY" words (role=alert) rendered under an INFO / WARN broadcast in its full-screen form with no tenant alert | **Fixed** in `40a42483d`, after the approval: `pendingTextHiddenBy` takes the tenant alert; with none, a banner-class message hides the words as on `master`. Strictly narrower than the approved head. A unit case added that fails on the approved helper, and two 8i assertions (`7118e647d`) that fail on a build of the approved head and pass here. Reviewed in round 3 |
| The handoff said 868 passed, 0 failed on the plain JVM; the reviewer got 867 / 1 failed (`BridgeNonceDeliveryTest` writes `apps/player/app/build/nonce-delivery-fixture.json`, and that folder did not exist) | **Corrected.** The folder is Gradle's build directory, which always exists in CI; the final run below creates it first and says so |
| The 0.1 reserved inset applied when the page's measured banner height has not arrived yet | On the bench drill checklist (step 2) |
| Episode memory (watch raise, refusal) is in process memory only | Named in the PR body and below; JVM tests pin the later posture check |
| `takeover-kept` changes what the page shows; a reload under a held banner regains banner posture | On the bench drill checklist and in the PR body |
| Commit attribution | Checked: this session's attribution line is the one the commits carry |
| CI (both Emergency path jobs with WebKit, `player-kotlin-check`), the owner's drill, a field candidate | Still owed (see "What is unverified") |

- **Round 3: approved** (`40a42483d`, `7118e647d`; read-only, an independent reviewer). Its findings:
  - **Correct and strictly narrower.** The words are hidden: on `master`, under any pushed message; on the approved head, under a full-screen pushed message; on `40a42483d`, under a full-screen pushed message, or under a banner-class message with no tenant alert. The new head differs from the approved head only for a banner with no tenant alert (back to `master`), and from `master` only for a banner under a tenant alert (the words now show: the fix).
  - **No sequence hides the words while a signed OVERRIDE is pending.** `tenantAlertUp` and `decideEmergencySurface` read the same `pendingOverrideConfirmRef.current` in the same render. A held banner under a pending OVERRIDE is suppressed and the words show; SOS / MEDIA_ALERT / CRITICAL paint their own alert; a manifest alert (live, drill, cached, provisional) renders `emergencyFallback` ahead of the words; the 30 s unconfirmed-OVERRIDE timeout with a refused banner still held draws the opaque full broadcast. No cache, hold or `applyManifest` logic changed.
  - **Paint proof unchanged.** `emergencyExpectedIdentityRef` is not touched; `data-edu-emergency-pending` has no consumer outside `page.tsx`, so it is not a proof input.
  - **The 8i assertions pin it**: two added `toHaveCount(0)` lines, each after a visibility assertion, so neither passes vacuously. Nothing loosened. Taurus: no style change; `check-inset-serialization.cjs` 0 confirmed.
  - Ran `emergencySurface.test.ts` and `softBlankRenderExits.test.ts`: 26 tests pass.

| Round-3 should-fix | Disposition |
|---|---|
| No test pins the protective wiring at the call site: `pendingTextHiddenBy(pushedEmergencyMessage, false)` would leave a wordless coloured surface under a banner held during a typeless signed OVERRIDE, and nothing would fail | **Fixed** in this commit: `emergencySurface.test.ts` parses `page.tsx` with the TypeScript compiler (comments cannot satisfy it) and pins that `tenantAlertUp` is `tenantAlertOnGlass(...)` reading `!!pendingOverrideConfirmRef.current` (the same ref `decideEmergencySurface` reads), and that `pendingTextHiddenBy`, `drawnPushedMessage` and the overlay's `suppressBanner` each take `tenantAlertUp`. Negative control: with the call site and `suppressBanner` set to `false` it fails (1 failed, 20 passed); restored, 21 pass. ESLint and `tsc` clean on the file |
| A banner known only to the overlay's poll (`pushedEmergencyMessage` still null) with a refused posture would show the words under the full broadcast | Not changed: identical to `master` and the approved head, transient (the page adopts the polled message into its held set) and covered by the opaque full form. Named below as a follow-up |
| The handoff's behaviour list should state the three-way rule | Done: the table row above under "Web player" already states it; this section states it in full |

## Evidence

### Red first (unfixed code)

Against a production build of the unfixed web bundle (`bundleId=79f7662c75e8`), the new cases in `apps/web/tests/e2e/emergency-path.spec.ts`, Chromium headless shell 1243, `--workers=1`. All four failed:

```
✘ 8e … Error: the drill must cover everything — the broadcast banner stayed up over it in the demo
      expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)  Expected: 0  Received: 1
✘ 8f … Error: the drill must cover everything, the banner included            Expected: 0  Received: 1
✘ 8g … expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)   Expected: 0  Received: 1
✘ 8h … Error: the first live manifest after the SOS clear must tell the app the takeover ended
      Expected: true  Received: false  (Timeout 10000ms exceeded while waiting on the predicate)
4 failed
```

A second run with every assertion soft (a scratch copy of the spec, never committed) showed the rest of what was wrong:

```
8e  the takeover must own the glass at (960, 20)                                   Expected: true      Received: false
8e  the paint receipt must certify the DRILL on the glass, not the broadcast banner Expected: "ed7663d2" Received: "ce3c94a7" (the banner)
8f  the first live manifest after the all-clear must tell the app the takeover ended: displayEmergencyHold(true, true, true)  Received: false
8g  webTabsShow bounds after the all-clear: left 60 / top 158 / width 1800 / height 922, against the canvas rectangle 0 / 96 / 1920 / 984
8g  displayEmergencyHold(true, true, true) after the all-clear                     Received: false
```

A later re-run on a temporary worktree at `origin/master` `9999f1967` with only the final spec copied in reported 8e, 8f, 8g, 8g-old and 8h failing (5 of 5, 8g-old only on the banner over the drill). **Its log was not kept**, so only the first red run (`scratchpad/eob/red-first.log` on the build machine, not durable) has a log. 8i (round 1) was never run against the unfixed `master` bundle. Its round-2 assertions were run red first against the approved head (see "Final gates"); the round-2 unit case fails on the approved helper by construction (it asserts `true` where the helper returned `false`).

The APK half's red-first is a JVM case: `BroadcastBannerTakeoverEndedTest` against the unfixed `BroadcastBanner.kt` (the promotion branch replaced by "keep the takeover"): 6 of the new tests fail; with the episode-refusal guard removed, 3 fail.

### Final gates (`40a42483d` and `7118e647d`, this handoff on top)

Run by the final-gates step on one 16 GB / 4 CPU machine, every heavy command through the machine-wide lock, one at a time. Tree: `40a42483d` (plus this handoff's uncommitted rename for the doc checks); the 8i re-runs and the second `tsc` on `7118e647d`. The web bundle is a production build with `NEXT_PUBLIC_API_URL=http://api.invalid/api/v1` (CI's web-build job uses the production API URL; the bundle budget was measured on this build). Chromium is the headless shell 1243 through a scratch config (the repo pins 1217), `CI=true E2E_PREBUILT=1`, `--workers=1 --retries=0`, port 3121 with `E2E_BASE` on the same port. Logs: `scratchpad/eob-final/logs/` on the build machine (not durable).

| Gate | Result |
|---|---|
| pnpm lockfile drift (`pnpm install --frozen-lockfile --lockfile-only`) | pass |
| Prisma generate; workspace packages (`api-types`, `scoreboard-cts`, `signage-design`); `pnpm --filter api build` | pass |
| Web `tsc --noEmit -p tsconfig.json` (includes `tests/e2e`) | exit 0, on `40a42483d` and again on `7118e647d` |
| Web `next build`; `check-bundle-budget`; `check-client-sentry` (self-test + run); `check-sw-shell` | pass; bundle within the ratcheted ceiling (2181 chunks, 20.17 MB, largest 0.84 MB / 207 KB gzipped) |
| API jest `src/emergency src/realtime src/email src/tenant-isolation src/screens/playback-config src/config`, `--ci --maxWorkers=2` | **66 suites, 1936 tests passed** |
| Web jest, the full suite, `--ci --maxWorkers=2` | **727 suites, 10778 tests passed** |
| `check-i18n-parity` (web; en, es, zh agree on 7691 keys) and `check-android-i18n-parity` | pass (no new user-facing string) |
| `check-tenant-isolation` | pass (0 unscoped, 0 grandfathered) |
| `check-env-declared`; `generate-env-docs --check` | pass (281 declared, 72 kill switches, 0 errors); `docs/ENVIRONMENT.md` and `.env.example` match |
| `mobile-perf-guard`; `check-pill-rules` | pass |
| `check-inset-serialization`; the taurus-safety scripts (`check-taurus-safety`, `check-scene-css`, `check-variant-registry`, `check-board-editability`, `check-widget-truth`, `check-font-ceilings`) | pass (0 confirmed landmines; every finding baselined) |
| `check-rulebook` (self-test + run), `check-incident-records`, `check-doc-age --max-days 180` | pass, with the handoff at its new path |
| `check-request-budget` (self-test + run) | pass (player timers 44 / 44, components/player 8 / 8: no new timer, no new network call) |
| `check-schema-has-migration` (`BASE_SHA` = merge-base with `origin/master`, `cb0b052c1`) | pass (`schema.prisma` unchanged) |
| `check-model-retirements`, `check-package-tests`, `node --test scripts/__tests__/*.test.cjs` | pass (127 of 127) |
| `scripts/check-apk-versions.cjs` | pass (`unit.version` 1.1.29, `manager.version` 1.1.29; nothing bumped, nothing tagged) |
| **E2E, Chromium**: the `emergency-path.yml` list (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`) plus `broadcast-banner-style`, `broadcast-composer`, `broadcast-playback`, `website-tabs`, and the two other specs that read the pending marker (`player-unpair-confirm`, `player-canvas-geometry`) | **95 passed, 0 failed, 1 skipped** (7.1 min). 8e, 8f, 8g, 8g-old, 8h and 8i pass; `website-tabs.spec.ts:106` (builder happy path) passes. The skip is the existing Chromium `test.fixme` at `emergency-drill-paint-proof.spec.ts:369` |
| 8i with the round-2 assertions (`7118e647d`) | **fails on a production build of the approved head `57519f116`** ("no pending EMERGENCY words under a broadcast when no alert is up", Expected: 0, Received: 1); **passes** on a build of this head |
| **APK, plain JVM**: the scratch Gradle project (Kotlin 1.9.24, JUnit 4, org.json, JDK 21; working directory `apps/player/app`, so the source-fact tests read the real files): every `src/test` class that compiles without Android classes (78 test files) against the main files that import no Android class, plus scratch-only stand-ins never committed (a recording `PlayerLogger`, a `BuildConfig`, a verbatim copy of the pure `BannerPaintReceipt`) | **870 tests: 868 passed, 0 failed, 2 skipped** (the skips are `master`'s: two "web half" cases that look for `../../../web/src/...` from the module root). `apps/player/app/build/` was created first: Gradle's build directory, which always exists in CI, and which `BridgeNonceDeliveryTest` writes its fixture into (without it that test fails, as in the round-2 run). Included: `NativeAlertWatchWiringTest` 16 (the edited pin), `BroadcastBannerTest` 6, `BroadcastBannerRotatedTest` 8, `BroadcastBannerTakeoverEndedTest` 18, `BridgeNonceDeliveryTest` 7. A UTF-8 locale is needed (a POSIX locale breaks Gradle's state tracking on the test classes with non-ASCII names) |
| **Not run here** | **`testDebugUnitTest` and `lintDebug`** (the real Android Gradle build): there is no Android SDK on this machine (`find / -name android.jar -o -name sdkmanager` finds nothing, no `ANDROID_HOME`, no `local.properties`), so the Android half has **never been compiled**; `player-kotlin-check.yml` is the proof. **WebKit** (not installed; CI's). The Docker build + boot smoke test and the renderer image (no Docker run here). `tools/check-player-http-outage.cjs` (needs the pinned Chromium 1217) |

### Earlier rounds (kept for the record)

- **Round 1, on the merged head `1d3b0811c`:** the Chromium e2e list plus `broadcast-banner-style`, `broadcast-composer`, `broadcast-playback`, `website-tabs`: 64 passed, 0 failed, 1 skipped; web unit tests (`src/app/player`, `src/components/player`, `src/components/widgets`, `src/components/layout`): 221 suites, 3494 tests passed; web `tsc` and `next build` exit 0. The plain-JVM Kotlin count recorded then (868 passed, 0 failed) needed the build folder; the reviewer's run without it was 867 passed, 1 failed (`BridgeNonceDeliveryTest`).
- **Round 2, by the reviewer on `57519f116`:** e2e 62 passed, 0 failed, 1 skipped; web unit 15 suites, 335 tests; Kotlin plain JVM 867 / 1 failed (the build folder) / 2 skipped.
- **Round 0, on `9999f1967` plus the fix:** e2e 62 passed, 1 failed (`website-tabs.spec.ts:106`, the builder happy path: a local-port CORS artefact, not the code; `master`'s own CI passes it on :3000), 1 skipped; 8e–8h `--repeat-each=3`: 15 passed, no flake.

## What is unverified

- **Everything on the glass.** No device was used. The e2e cases see the page and what it posts to a recording native channel; no e2e can see the APK's mask, its native video or the L55VEC's compositor.
- **WebKit.** Not installed on this machine; both Emergency path jobs run it in CI.
- **The APK half's Android code has never been compiled.** There is no Android SDK here. The pure `BroadcastBanner` logic and every unit-test class that compiles without Android classes ran on a plain JVM; `DisplayEmergency`, `WebAppBridge`, the channel, both hosts, `SharedVideoHost`, `BroadcastContentViews` and `MainActivity`, and the 20 test classes that need Android classes (`HoldReleasePageProofTest`, `FaceBridgeIsolationTest`, `FaceEmergencyHoldTest` and others), are compiled and run only by `player-kotlin-check.yml`.
- **The real L55VEC.** Which APK the demo screen ran is inferred. Native video after the downgrade is not proven: the page must intend it again, and D5 below could make a later web-to-native flip on the glass.
- **The round-3 source pin** ran as one jest file (with a negative control), not as part of a full suite run; CI runs the full web jest.

## Behaviour changes to name in the drill (the skeptic's amendment 7)

1. A page that reloads under a held banner (a service-worker update, an OOM, the paint ladder) now regains banner posture on its first live manifest, where it used to stay a full takeover until the broadcast ended.
2. An alert the native watch raised on a dark panel leaves the website masked until the broadcast ends, even after the all-clear. That is the fail-safe direction and expected, not a regression.
3. On a display rotated from its natural orientation, an earlier banner refusal keeps the takeover after the all-clear for the rest of that hold.
4. **`takeover-kept` changes what the page shows.** After a native-watch raise, or a posture refusal earlier in the hold, the app reports `broadcastBannerPosture: {posture: 'takeover-kept', reason}` and the page reads it like a refusal: the INFO broadcast becomes the full-screen presentation with playback held until the broadcast ends, where the unfixed page showed the banner over its content. Fail-safe, but visible.
5. A full-screen broadcast (the form used when the app refused banner posture) is no longer drawn over a tenant alert either: the drill owns the glass, and the full broadcast comes back at the all-clear (e2e 8i).
6. The episode memory (watch raise, refusal) is in process memory: after an app restart under a persisted hold, a live manifest with no alert promotes to banner. That is no weaker than the full release the same manifest could already cause, and the posture policy runs again before any native video starts under the banner.

## The bench drill (owner, test tenant, drill only, bench L55VEC)

1. **Web only, before any APK.** A website item on the screen; push an INFO broadcast; trigger a lockdown DRILL. The drill fills the glass with no banner. All-clear: the banner is back. Clear the broadcast: the banner goes, the website stays. On the L55VEC with today's APK the website stays dark between the all-clear and the broadcast clear (the APK half), and no `PLAYER_TAKEOVER_*` line appears.
2. **With a field candidate carrying the APK half.** The same sequence; after the all-clear the website is back under the banner within one manifest poll, with one durable `PLAYER_TAKEOVER_ENDED` line. The site must not overlap a taller banner for more than a moment after the all-clear (the 0.1 reserved inset until the page's measured height arrives). Repeat with Website Tabs (the site area sits exactly under the tab bar, not shrunk twice), with a native video item (it plays again, with no web-to-native flip), and with an SOS over the banner, then cleared.
3. **The kill switch.** With `EMERGENCY_BANNER_RESTORE_DISABLED=1` on the API: the drill still covers the banner; after the all-clear the website stays dark until the broadcast is cleared (today's APK behaviour).
4. **The receipt.** During the drill the render-proof hash `em:<identity>` is the drill's, not the broadcast's.
5. **The named behaviour changes above**, especially 2 and 4: reboot the panel to standby, let the native watch wake it with a drill, and expect the website to stay masked until the broadcast ends.

## Release path for the APK half (rules 9 and 13)

- `testDebugUnitTest` + `lintDebug` green in CI, then a **field candidate on the bench L55VEC first**, delivered through `/super/field-builds`. The field-candidate registry already goes to `1.1.67-field.1` (versionCode 10167), so this is `1.1.68-field.1` or later; a stable bump from `unit.version` 1.1.29 to 1.1.30 (versionCode 10130) cannot install over a field build (the skeptic's amendment 5).
- Any stable `player-v` tag must carry a versionCode above every field build in use, and `maxhub-l55vec-a13` is a REQUIRED class with no PASS ever: it needs a PASS, including the emergency-drill row, or a named, logged override.
- OTA rules: one hardware class per push, off-hours, never during playback. No version was bumped and nothing was tagged here.

## Named follow-ups (found by reading, not fixed here)

- **D5.** A media playlist committed while a banner is held (`commitMediaPlaylist(commit, holdNow || …)` in `page.tsx`) gets a null native-video descriptor, which can flip web to native later on the glass. The fix changes the emergency path's media commit and needs its own test.
- **The qualification checklist's drill row** has no broadcast step (Investigation 2, item 6). Proposed wording is above.
- Fail-closed option: also require the native `ManifestAlertScanner` to read NO_ALERT before a downgrade. Not done.
- Persisting the episode memory across an app restart. Not done (behaviour change 6).
- **Poll-only banner and the pending words** (round 3, should-fix 2): pass the drawn-or-polled message to `pendingTextHiddenBy` so a banner seen only by the overlay's poll is treated like a held one. Same behaviour as `master` today, covered by the opaque full form.
- The `E2E_PORT` override does not move the CORS origin several specs answer with (`E2E_BASE`, default :3000), so a local run on another port fails specs like the builder happy path for a reason that is not the code. A one-line fix in `playwright.config.ts`; not done here.

## Rollback

Revert the PR, or redeploy the previous web build. The web half alone is safe to revert separately (the APK then never receives the third argument and keeps the takeover). With only the APK half reverted, an app ignores the third argument and stays a full takeover. No schema, no migration. Short of a revert, `EMERGENCY_BANNER_RESTORE_DISABLED=1` turns off the takeover-ended signal.
