# Android player repair candidate - 2026-11-03

Status: local repairs implemented and tested; production delivery and hardware recovery **unverified**. This is a scoped repair, not a completed product/security audit.

## Changes

- Restore native control delivery independently for each page checkpoint, with exact origin checks and bounded acknowledgement/retry handling. Existing authorization and emergency lifelines remain in force.
- Normal-playlist chunks validate their actual EOF before atomic publication, avoiding a duplicate disk copy. Reclaim only the matching abandoned normal-playlist temporary chunk; resume recovers metadata when a committed chunk survived an interrupted worker. Preserve full-file verification, previous playable generations and emergency storage behavior.
- Replace fabricated storage defaults and rounded-zero capacity with validated, nullable browser-origin estimates. These values do not measure Android physical free disk or native media storage.
- Enforce the existing 30 fps native-admission ceiling consistently in video preparation and output verification. Existing assets are not re-encoded by this deployment.

## Validation

- Android `testDebugUnitTest` and `lintDebug`: passed (1554 tests, 2 skipped).
- API full suite after rebuilding the isolated worktree's shared types: 613 suites passed, 3 skipped; 11690 tests passed, 30 skipped. The first run used stale shared package output and failed; that run is not a pass.
- Web worker/storage/rate contract suites: 56 tests passed before the two extra interrupted-metadata cases; latest focused publication suite: 14 passed.
- Chromium and WebKit: actual storage menu (6 cases), generated Android delivery script (reload, subframe, execution-origin, default ports), one-file staging budget, malformed network streams, and new-worker metadata recovery passed.
- Chromium decoded the verified offline chunk-backed video. WebKit's budget harness verified CacheStorage integrity only; native hardware playback remains unqualified.
- Production build, CI, signed candidate and camera drill must be recorded separately; local tests do not establish field recovery.

## Incident limits

The owner observed an alert briefly appearing, then black; a clear restored one screen but others reported `idle:content-downloading`. A later owner-triggered alert appeared to restart the player and restore it. Alert disappearance is **not explained or repaired by evidence yet**. The candidate must not be presented as a verified emergency repair or a verified repair of another hardware class's pause/play-icon issue.

Fresh telemetry and the dashboard reported affected units on 1.1.55-field.1, despite a newer candidate being available. No fleet push, tenant move, agent-triggered live alert, or all-clear has occurred in this work.

The owner requested Astra review, selected one lab screen for testing, then requested keeping review within Astra and stopping further Astra work. Designs were reviewed before implementation; three implementation corrections were addressed and tested. No different-vendor review occurred; no source was sent to Claude. Preserve this review limitation in the PR and release decision.

## Rollback

The four fixes are separate commits. Revert the affected commit through a PR; retain the previous signed APK for a single-screen rollback. Do not clear device identity, emergency state or protective caches to roll back. A merge deploys web/API code; an APK installation is a separate operation.

## 2026-11-07 — rebased for 1.1.65 and reviewed by a different vendor

Reviewer: Claude Opus 5.5 (Anthropic), Claude Code harness. This is the different-vendor review the section above says was missing. It covers the code that remains in the PR.

- `origin/master` (through #258) merged in cleanly. After the merge, the PR's net diff against master is only the 30 fps ceiling, its tests and this file. The other three repairs are already on master, byte for byte. The bridge-nonce checkpoint delivery came in with the #255 squash (`9a6173780`). The chunk publication, storage estimates and browser-worker tests came in with #253 (`821717022`). The 1.1.64 field build (source `aa444aa7e`) has the same nonce code as master, so a 1.1.65 built from master does not regress it.
- Bridge contracts are unchanged. No bridge method was added or renamed. `GATED_METHODS`, METHODS, the dispatch arm, NATIVE_VOID/VALUE_METHODS and KNOWN_METHODS are untouched. The emergency hold is not nonce-gated (see `BridgeNonce.GATED_METHODS`).
- 30 fps ceiling (API): `screenCompatibilityIssues`, `targetFps` and `verifyTranscodeOutput` now apply the same strict `> 30` rule as native admission (`native-shared-video.ts`, `FaceVideoPolicy.kt`, `SharedVideoPolicy.kt`, `nativeZones.ts`). The change is correct, and nothing was removed.
  - Consequence: a **new** upload measured at 30.0x to 30.5 fps is now "not ready until converted". This is common for phone video, where `avg_frame_rate` is frames divided by duration. Such a file goes through a required transcode with `fps=30`. Before, it was delivered at once and played on the web engine only.
  - Existing assets are not re-evaluated.
  - The real-ffmpeg round trip ran (ffmpeg is installed locally, so it was not skipped). It shows that `fps=30` output probes at 30 fps or less.
- Tests run on the merged tree:
  - Android `testDebugUnitTest` + `lintDebug`: 1570 tests, 0 failures, 2 skipped.
  - API `src/assets src/screens src/storage`: 128 suites; 2485 tests passed, 5 skipped.
  - Web `src/app/player` Jest: all 121 suites pass (after building `@cms/scoreboard-cts`).
  - Web `tsc --noEmit`: clean. API `tsc -p tsconfig.build.json`: clean.
- Still unverified: behaviour on the glass, and the emergency black-after-alert symptom, which this PR does not address.
