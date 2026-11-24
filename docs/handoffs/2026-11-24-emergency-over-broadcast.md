# An emergency takeover outranks a broadcast banner; its all-clear restores the content and the banner (2026-11-24)

**Status.** Branch `claude/emergency-over-broadcast`, cut from `origin/master` `31ebf86e7` and fast-forwarded to `9999f1967` (PR #353) before the final runs. One commit (the fix, its tests and this handoff). Not pushed, no PR, not merged, not deployed. Since then `origin/master` moved to `27a444e32` (#354 sync engage measure, #355 rebrand placeholders): `git merge-tree` reports one conflict, `CHANGELOG.md` (both added an entry at the top; keep both, the 2026-11-24 entry first), and `page.tsx` merges cleanly. The results below are for this commit on `9999f1967`; the merged head needs CI. Everything said about a real screen below is **unverified** until the owner's bench drill. WebKit is not installed on the machine this was built on, so every WebKit result is CI's.

- **The owner's words (2026-11-23, after a live demo):** "in my demo today I pushed a broadcast, then pushed an emergency drill but it left the banner up, then when I stopped the emergency the web url on the l55vec screen never came back until I killed the broadcast … emergency alert o strides everything and canceling needs to bring back original content including the broadcast".
- **Life-safety CHANGE class** (`CLAUDE.md` §5). The owner waived the different-vendor review in writing ("Don't worry about another model review"). The waiver covers the review only. The on-glass drill on a bench L55VEC, in a test tenant, drill only, stays the owner's.
- **Two layers, two ways to reach a screen.**
  - **Web player** (`apps/web`): ships with the web deploy, and is safe on every APK. It fixes "the banner stayed up over the drill" on every screen.
  - **APK** (`apps/player`): reaches a screen **only through a player release** (`apps/player/CLAUDE.md` rule 9, the hardware qualification gate, and rule 13, the release). Until it ships, an L55VEC still keeps the native website dark after the all-clear for as long as the broadcast lasts. **Workaround until then:** clear the broadcast after the all-clear.
- **Not in this change:** the alert email in UTC instead of the screen's local time (its own track); which of a pushed SOS / MEDIA_ALERT / CRITICAL text and a tenant lockdown or drill outranks the other (the owner's call: both keep today's draw, a drill never hides a real SOS).

## Root cause, in one paragraph

A tenant alert (a manifest OVERRIDE, live or drill) and a pushed TEXT_BROADCAST are separate tiers, and nothing said which one wins. The banner was portalled at z-index 9999 over the alert's surface (9998), scaled a staged board down beneath it, and owned the paint receipt. They share one display hold on the APK, and that hold could move only one way: from banner posture to a takeover when the alert arrived, never back while the broadcast kept the hold raised. At the all-clear the page asked for banner posture again; the APK refused both halves on purpose (`BroadcastBanner.set`: held with no insets; `BroadcastBanner.hold`: held before and not a banner holder), silently, so the native site view stayed masked (`BroadcastContentViews.apply`) while the page believed it was in banner posture and kept posting `showUrlOverlay`. Only the full release, when the broadcast ended, un-masked it. The plan and the skeptic's amendments are the inputs to this work; the skeptic's amendments were applied where they differ from the plan.

## What changed

### Web player (ships with the web deploy)

| | Before | Now |
|---|---|---|
| An INFO / WARN banner while a tenant alert is up (manifest alert, signed OVERRIDE being confirmed, staged emergency board) | Drawn over the alert at z 9999; the staged board was inset under it | Held but not drawn, in either presentation (also the full-screen form the page uses when the app refused banner posture, which used to cover the drill completely); its layout is withdrawn, so nothing is inset (`emergencySurface.ts` `tenantAlertOnGlass` / `drawnPushedMessage`, `EmergencyOverlay` `suppressBanner`) |
| The pushed set, the 12 s reconcile, the overlay poll | | Untouched. The banner comes back by itself at the all-clear |
| The paint receipt during the drill | Certified the banner (the topmost root) | Certifies the drill: the banner root is not drawn, and the expected identity follows what is drawn |
| The protective pending "EMERGENCY" words while an OVERRIDE awaits its manifest | Hidden by any held pushed message, a banner included | Hidden only by a full-screen pushed message (`pendingTextHiddenBy`) |
| After the all-clear, with the broadcast still up, on our app | The page sent `displayEmergencyHold(true, true)`; the APK refused it | The manifest handler's LIVE answers (the 200 apply when not from cache, the live 304, the unconfirmed-OVERRIDE timeout) send `displayEmergencyHold(true, true, true)` on every banner-posture raise: "the takeover ended, only the banner remains" (`emergencyHold.ts` `liveManifestHold` / `openLiveManifestHold`: a scope that covers the one hold call inside it, so every hold statement keeps the exact text the wiring tests pin, `nativeFirstWiring.test.ts` and `displayControl.test.ts`). Never a cached manifest, a push, a clear, a reconcile, an effect or the paint reassert. The legacy transport still gets one boolean (`legacyArgs`) |
| Website Tabs bounds under a banner | `getBoundingClientRect()` (already scaled and moved by the page), which an app with `BroadcastContentViews` then transformed again: shrunk and shifted twice | On such an app, canvas coordinates (`broadcastLayout.ts` `nativeSiteViewRect` → `canvasRectFromGlass`, the inverse of the one formula the page's style uses, published by a layout effect). On any other app the glass rectangle, as before (see "One deliberate departure") |
| The app reports it KEPT the takeover (`broadcastBannerPosture.posture: 'takeover-kept'`) | (no such state) | Read like a refusal: full broadcast presentation, playback held, no native site claimed ready |

Why "every live banner raise" and not "only the flip" (the skeptic's amendment 1): in the SOS-over-banner sequence the flip back to banner posture happens on the push path (`commitPushedMessages('clear')`), so the next manifest never flips, and a page reloaded under a persisted hold has no memory of the takeover the APK still holds. The APK applies the argument idempotently and only behind its own guards.

### One deliberate departure from the plan: Website Tabs bounds depend on the app

The plan (A6) said to post the Website Tabs site area in canvas coordinates. That is right only on an app that applies the banner transform to the site view itself (`BroadcastContentViews`, commit 8a2d8aa88, in the field builds). **Stable player 1.1.29 has Website Tabs and no `BroadcastContentViews`** (`git merge-base --is-ancestor 53acd5624 player-v1.1.29` is true, and false for 8a2d8aa88), so on it a canvas rectangle would put the native site over the tab bar and a strip of the banner. So the page posts canvas coordinates only when the app reports `broadcastBannerVersion` ≥ 1 on its existing `sharedVideoState` reply, read once at boot by the protocol discovery (`noteNativeBannerSupport`). That key arrived in f51896253, whose direct child is 8a2d8aa88, and no field build sits between them. In doubt (no reply yet, a browser, an old app) the page posts the glass rectangle, today's behaviour. 8g runs both ways: a field-build channel that answers `sharedVideoState` (canvas rectangle) and `8g-old`, a channel that does not (glass rectangle, unchanged).

### APK (reaches a screen only through a player release)

- `media/BroadcastBanner.kt`: the anti-downgrade rule stays for every implicit path; geometry alone still never downgrades a takeover, and both `BroadcastBannerTest` cases that pin it are unchanged and green. Its one exit is `hold(…, takeoverEnded = true)`. Geometry refused while held is kept as `pending` (dropped by `clear`, an inactive `set`, a takeover hold and `endHold`). A trusted takeover-ended promotes it and restores the banner holder, unless:
  - the native alert watch raised the hold in this episode (`native-watch`);
  - banner posture was refused on the face at any point in the hold episode (`episodeRefused`, which, unlike `refused`, survives the inactive geometry the page sends when a takeover starts and a document retire — the skeptic's amendment 6);
  - no banner geometry has arrived yet (`no-geometry`, transient, not reported; the next live manifest asks again).
- `display/DisplayEmergency.kt`: records a native-watch raise per hold episode (box-wide: a watch raise on any face blocks every face's downgrade), passes `takeoverEnded` only from the page, ends the episode memory on release and on a face's narrow, re-shows a masked site view after a promotion (`BroadcastContentViews.refresh()`), and writes one durable `PLAYER_TAKEOVER_ENDED` line per promotion and one `PLAYER_TAKEOVER_KEPT reason=…` line per newly kept takeover. The display hold itself stays raised until the broadcast ends, so blanking, dimming and wake are unchanged.
- `display/DisplayControlApi.kt`: `takeoverEnded && bannerOnly && trusted`. `security/NativeBridgeChannel.kt`: a literal `true` third argument routes to `WebAppBridge.displayEmergencyHoldTakeoverEndedViaSecureChannel`; no face from the page. `WebAppBridge.kt`: a new optional host entry; a release or a takeover is the plain hold, and an unwired or throwing entry still sends the plain banner raise (a raise is never lost). `MainActivity.kt` / `face/FacePlayerHost.kt` wire it with their own face.
- `media/SharedVideoHost.kt`: `broadcastBannerPosture: {posture: 'takeover-kept', reason}`, an additive key on an existing value method (no new bridge method; rule 9's three-file contract does not apply).
- D6, `media/BroadcastContentViews.kt` + `MainActivity.kt`: a site view that replaces one whose renderer died while masked inherits the mask, so a release shows it again (it used to come back INVISIBLE with masked=false, and nothing ever showed it).

### Kill switch

`EMERGENCY_BANNER_RESTORE_DISABLED` (API, `docs/ENVIRONMENT.md`, generated) → `playback.bannerRestore: 'off'` in the hashed manifest (absent when unset, so no ETag moves). The page then omits the third argument and the app keeps the takeover until the broadcast ends, as before. **Failure direction:** an omitted or ignored third argument (an old APK, the switch, a lost message) leaves the screen a full takeover, today's behaviour. The web half ("an alert outranks a banner") is not switched off by it.

## Evidence

### Red first (unfixed code)

Recorded by the earlier run of this step (cut off by a usage limit and a reboot), against a production build of the unfixed web bundle (`bundleId=79f7662c75e8`), with the new cases 8e–8h in `apps/web/tests/e2e/emergency-path.spec.ts`. Chromium headless shell 1243, `--workers=1`. All four failed:

```
✘ 8e … Error: the drill must cover everything — the broadcast banner stayed up over it in the demo
      expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)  Expected: 0  Received: 1
✘ 8f … Error: the drill must cover everything, the banner included            Expected: 0  Received: 1
✘ 8g … expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)   Expected: 0  Received: 1
✘ 8h … Error: the first live manifest after the SOS clear must tell the app the takeover ended
      Expected: true  Received: false  (Timeout 10000ms exceeded while waiting on the predicate)
4 failed
```

A second run with every assertion soft (a scratch copy of the spec, never committed) showed the rest of what was wrong on the unfixed code:

```
8e  the takeover must own the glass at (960, 20)                                   Expected: true      Received: false
8e  the paint receipt must certify the DRILL on the glass, not the broadcast banner Expected: "ed7663d2" Received: "ce3c94a7" (the banner)
8f  the first live manifest after the all-clear must tell the app the takeover ended: displayEmergencyHold(true, true, true)  Received: false
8g  webTabsShow bounds after the all-clear: left 60 / top 158 / width 1800 / height 922, against the canvas rectangle 0 / 96 / 1920 / 984
8g  displayEmergencyHold(true, true, true) after the all-clear                     Received: false
```

**Re-run by this step on the exact base of the commit.** A temporary worktree at `origin/master` `9999f1967` with only the final `emergency-path.spec.ts` copied in, a production build of that unfixed bundle, Chromium headless shell 1243, `--retries=0`: **5 failed of 5**.

```
✘ 8e      Error: the drill must cover everything — the broadcast banner stayed up over it in the demo   Expected: 0  Received: 1
✘ 8f      Error: the drill must cover everything, the banner included                                    Expected: 0  Received: 1
✘ 8g      expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)                           Expected: 0  Received: 1
✘ 8g-old  expect(locator('[data-edu-emergency-root="banner"]')).toHaveCount(0)                           Expected: 0  Received: 1
✘ 8h      Error: the first live manifest after the SOS clear must tell the app the takeover ended        Expected: true  Received: false
5 failed
```

8g-old fails there only on the banner over the drill; its bounds assertion is today's behaviour on an old app, which is what it guards. The temporary worktree was removed afterwards.

### Green (this branch)

All on this branch's final tree (head `9999f1967` plus this change), on a production build of the web bundle (`NEXT_PUBLIC_API_URL=http://api.invalid/api/v1`), Chromium headless shell 1243 through a scratch config (the repo pins 1217), `CI=true E2E_PREBUILT=1`, one worker.

| What | Result |
|---|---|
| The `emergency-path.yml` Chromium list (`emergency-path`, `emergency-drill-paint-proof`, `emergency-instant-board`, `player-native-dual-video`, `player-offline-lazy-renderer`) plus `broadcast-banner-style`, `broadcast-composer`, `broadcast-playback`, `website-tabs` | **62 passed, 1 failed, 1 skipped** (64 tests, 9.1 min) |
| The failure | `website-tabs.spec.ts:106` "builder happy path" (the dashboard builder, waiting 60 s for a "Widgets" tab), on every retry. **It fails the same way on unfixed `master` `9999f1967`** in the temporary worktree, so it is not this change; it is the builder UI in this sandbox and needs its own look |
| The skip | `emergency-drill-paint-proof.spec.ts:369`, a `test.fixme` for Chromium already on `master` |
| 8e, 8f, 8g, 8g-old, 8h, `--repeat-each=3 --retries=0` | **15 passed** (1.9 min), no flake |
| Web unit tests: `src/app/player`, `src/components/player`, `src/components/widgets` | **201 suites, 3271 tests passed** |
| Other web tests that read the changed sources (`components/layout` EmergencyOverlay × 3, `AppToaster.zindex`, `corner-popups.no-yellow`) | 5 suites, 47 tests passed |
| Web `tsc --noEmit -p tsconfig.json` (covers `tests/e2e`) and `next build` | exit 0, exit 0 |
| API jest `playback-config.spec.ts`, `env-schema.spec.ts` | 2 suites, 47 tests passed |
| `generate-env-docs.cjs --check`, `check-env-declared.cjs` | ok; 281 declared, 72 kill switches, 0 errors |
| `check-taurus-safety`, `check-inset-serialization`, `check-i18n-parity`, `check-request-budget`, `scripts/check-rulebook.cjs` | all exit 0 (no new string, no new timer, no `inset`, no flex `gap`) |
| ESLint on the changed web files | no new finding: the six errors and one warning reported in `WebsiteTabsWidget.tsx` / `EmergencyOverlay.tsx` are the same on `master` (the CI lint gate counts new `jsx-a11y` errors only; none added) |
| APK, plain JVM (Kotlin 1.9.24, JUnit 4, org.json; `BroadcastBanner.kt` with its three test classes, working directory `apps/player/app` so the source-fact tests read the real files) | **29 tests, 0 failed, 0 skipped** (`BroadcastBannerTest` 6, `BroadcastBannerRotatedTest` 8, `BroadcastBannerTakeoverEndedTest` 15) |
| APK mutation checks | with the promotion branch replaced by "keep the takeover" (today's rule), 6 of the new tests fail; with the episode-refusal guard removed, 3 fail (`aRotationRefusalEarlierInTheHoldSurvivesTheDrillsInactiveGeometry`, `aDocumentRetireKeepsTheEpisodeRefusal`, `theEpisodeEndsWithTheHold`) |
| **Not run here** | WebKit (CI's); `testDebugUnitTest` and `lintDebug` (no Android SDK: `player-kotlin-check.yml` runs them, including the new `HoldReleasePageProofTest` case); `tools/check-player-http-outage.cjs` (needs the pinned Chromium 1217) |

## What is unverified

- **Everything on the glass.** No device was used. The e2e cases see the page and what it posts to a recording native channel; no e2e can see the APK's mask, its native video or the L55VEC's compositor.
- **The APK half's Android code was not compiled here** (no Android SDK on this machine). The pure `BroadcastBanner` logic and its source-fact wiring tests ran on a plain JVM (below); `DisplayEmergency`, `WebAppBridge`, the channel, both hosts, `SharedVideoHost`, `BroadcastContentViews` and `MainActivity` are compiled and tested only by CI (`player-kotlin-check.yml`: `testDebugUnitTest` + `lintDebug`). `HoldReleasePageProofTest` gained a case for the new bridge entry that only CI runs.
- **Native video after the downgrade.** The page must intend it again; FaceVideoBox holds a surface that would start under a banner to the posture proof. Not proven. D5 below can make a later web-to-native flip on the glass.
- **Which APK the demo L55VEC ran** is inferred (field builds 1.1.56 to 1.1.67 contain the banner posture code; stable 1.1.29 has none). Telemetry was not read.

## Behaviour changes to name in the drill (the skeptic's amendment 7)

1. A page that reloads under a held banner (a service-worker update, an OOM, the paint ladder) now regains banner posture on its first live manifest, where it used to stay a full takeover until the broadcast ended.
2. An alert the native watch raised on a dark panel leaves the website masked until the broadcast ends, even after the all-clear. That is the fail-safe direction and expected, not a regression.
3. On a display rotated from its natural orientation, an earlier banner refusal keeps the takeover after the all-clear for the rest of that hold (the page then shows the full broadcast presentation).

## The bench drill (owner, test tenant, drill only, bench L55VEC)

1. Web only, before any APK: website item on the screen; push an INFO broadcast; trigger a lockdown DRILL. The drill fills the glass with no banner. All-clear: the banner is back. Clear the broadcast: the banner goes, the website stays. On the L55VEC with today's APK the website stays dark between the all-clear and the broadcast clear (the APK half), and `PLAYER_TAKEOVER_*` lines are absent.
2. With a field candidate carrying the APK half: same sequence; after the all-clear the website is back under the banner within one manifest poll, with one durable `PLAYER_TAKEOVER_ENDED` line. Repeat with Website Tabs (the site area sits exactly under the tab bar, not shrunk twice), with a native video item, and with an SOS over the banner then cleared.
3. With `EMERGENCY_BANNER_RESTORE_DISABLED=1` on the API: the drill still covers the banner; after the all-clear the website stays dark until the broadcast is cleared (today's APK behaviour).
4. Check the render-proof hash during the drill: `em:<identity>` is the drill's, not the broadcast's.

## Release path for the APK half (rules 9 and 13)

- `testDebugUnitTest` + `lintDebug` in CI, then a **field candidate on the bench L55VEC first**, delivered through `/super/field-builds`. The field-candidate registry already goes to `1.1.67-field.1` (versionCode 10167), so this is `1.1.68-field.1` or later; a stable bump from `unit.version` 1.1.29 to 1.1.30 (versionCode 10130) cannot install over a field build (the skeptic's amendment 5).
- Any stable `player-v` tag must carry a versionCode above every field build in use, and `maxhub-l55vec-a13` is a REQUIRED class with no PASS ever: it needs a PASS, including the emergency-drill row, or a named, logged override.
- OTA rules: one hardware class per push, off-hours, never during playback.

## Named follow-ups (found by reading, not fixed here)

- **D5.** A media playlist committed while a banner is held (`commitMediaPlaylist(commit, holdNow || …)` in `page.tsx`) gets a null native-video descriptor, which can flip web to native later on the glass. The fix (`!!em || alertStaysOnGlass`, or that plus "playback held") changes the emergency path's media commit and needs its own test; left for a separate change.
- An e2e variant where the app reports banner posture refused before the drill (the skeptic's amendment 3) is covered by a unit test only (`emergencyPaintProof.test.tsx`: `fullPresentation` + `suppressBanner` draws nothing); the e2e harness has no way to answer `sharedVideoState`.
- Fail-closed option for the reviewer: also require the native `ManifestAlertScanner` to read NO_ALERT before a downgrade. Not done.
- The native-watch episode flag is in memory: after a process restart under a persisted hold it is empty. The page sends the argument only when the live manifest shows no takeover alert, so the server of record still decides; persisting the flag is a follow-up if the reviewer wants it.

## Rollback

Revert the commit. The web half alone is also safe to revert separately (the APK then never receives the third argument and keeps the takeover). With only the APK half reverted, an app ignores the third argument and stays a full takeover. No schema, no migration.
