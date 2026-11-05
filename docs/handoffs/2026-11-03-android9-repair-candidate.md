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
