# Player renderer recovery — implementation and release notes

Implemented 2026-09-29. This change addresses recovery defects discovered during
an offline Android video-player investigation. The incident's exact initiating
fault is still unproven: a partial cache download and disappearance of native
heartbeats cannot distinguish a renderer failure, host-process termination,
power loss, or disconnection. Software decoding of the uploaded MP4 passed;
that result does not qualify its codec profile on the affected board.

## Native recovery

Android explicitly requires a WebView whose renderer has terminated to be
removed and destroyed. Reloading that instance is invalid. See the official
[renderer termination guidance](https://developer.android.com/develop/ui/views/layout/webapps/handle-termination).

- `SafePlayerWebViewClient` supplies the affected view and `didCrash` fact.
- `RendererRecovery.replace` removes the dead child, detaches its bridge,
  destroys it, creates a fresh WebView, and restores its parent slot, layout,
  ID and visibility. It never recreates the Activity or changes native holds.
- MainActivity rebinds ViewBinding and applies the existing origin/nonce-secured
  bridge configuration to the fresh primary view. A stale callback cannot certify
  or inject a nonce into a replacement view.
- The URL overlay also handles termination. A shared renderer can notify multiple
  clients; each affected slot replaces its own view. The overlay stays bridge-free,
  preserves its visibility and layout, and revalidates its last URL against the
  existing navigation policy before restoring it.
- Secondary faces own their recovery state and pending retry. Their recovery
  cannot certify another face or change another face's credentials.
- Retry delay is 2, 4, 8, 16, 32 and then 60 seconds. Persisted strikes survive
  host-process restarts, reset after 30 minutes without a renderer failure, and
  do not reset merely because a page finished loading. Network reconnection cannot
  bypass the renderer delay. No parallel direct reload is added.
- A recent native renderer failure adds `recoveredRenderer=<expiry-ms>` to the player URL.
  The web player uses that hint only for ordinary media.

## Ordinary-media protection

`playbackSafety.ts` is a versioned, bounded circuit breaker scoped to each face's
existing storage namespace. Its file identity is the stable URL without query
credentials plus the manifest SHA-256. Changing the file digest permits a fresh
attempt immediately; another file never inherits its block.

Before normal large-file download, adoption/verification, assembly or video
startup, a bounded breadcrumb is persisted. A completed operation, slide unmount,
or `pagehide` clears the corresponding breadcrumb. On boot, unfinished operations
less than 45 minutes old count as an *interruption*, not a diagnosed crash. Multiple
unfinished phases of the same file count once per boot.

One interruption selects conservative playback for six hours: one ordinary video
element, native looping, no hidden next-video decoder and no animated transitions
or MP4/MSE remux preparation. Healthy devices retain their existing continuous-loop
default. Two interruptions set aside only that exact file identity for six hours.
Other ready items continue. If every item is set aside, the existing Content
Unavailable surface appears instead of implying a download is progressing. The
minute tick expires the block and permits a subsequent retry. Neither block deletes
cached content or credentials.

Startup is considered established only after decoded frame counts advance over
30 seconds. The ordinary video stall watchdog also observes decoded frame progress
when the WebView exposes it: an advancing media clock with frozen decoded output
now triggers the existing in-place recovery/skip path. Devices without usable frame
counters retain the previous clock-based detector. A frame counter is evidence of
browser decode activity, not a camera observation of the physical display.

Emergency playlists bypass the circuit breaker, conservative rendering and new
frame sampling. Emergency asset calls retain their original cache-tier behavior.
The emergency trigger, all-clear, HMAC, polling, protected cache lifetime and native
hold code are unchanged. No live alert was sent during verification.

## Persistent diagnostics

- Renderer termination persists `didCrash`, the WebView slot, strike count and
  chosen retry delay in the rotating native log before replacement.
- Android 11+ ApplicationExitInfo records available prior ANR, low-memory, JVM and
  native-process exits on next boot. Older Android versions skip this optional
  OS source. Absence of an exit record is not proof of a healthy process.
- Selected ordinary playback warnings are persisted at most once per minute,
  bounded to 512 characters with URLs and JWT-like strings redacted.
- `/api/v1/player-logs/:screenId` recognizes up to 32 recovery markers per upload,
  attributes them only through the existing verified device credential and live
  tenant, and writes `PLAYER_RECOVERY_EVENT` audit entries. Routine uploads still
  produce no audit entry. Repeated rotating-log uploads are checked against a
  timestamped-line SHA-256 and do not recreate previously stored events. This is
  lookup-based deduplication; simultaneous identical uploads are not covered by a
  database uniqueness constraint. A concurrent JVM fatal exception still gets its
  original fatal-crash audit record.

## Verification and release boundary

Local validation includes the full player web unit suite, native unit tests and
Android lint, production preflight, API diagnostics tests, tenant-isolation and
Taurus inset guards, browser tests for existing loop/emergency behavior, and an
Android instrumentation test that deliberately loads `chrome://crash` in a debug
fixture. That test verifies both WebViews sharing the terminated renderer recover
and the Activity survives. The fixture is excluded from release APKs.

Recorded local results: 840 web player unit tests passed; 575 Android unit
tests passed and two existing tests were skipped; 14 API diagnostics tests passed;
24 Chromium and 16 WebKit browser tests passed; the forced shared-renderer crash
instrumentation test passed. Android lint, production preflight, TypeScript,
tenant isolation and Taurus inset checks passed. The existing monolithic player
page retains its prior 139 ESLint errors/42 warnings; this change adds no new
rule violations. The changed supporting modules pass ESLint.

The GitHub security scan uses the documented official registry fallback order so
an ECR HTTP 429 cannot silently prevent scanning. Scan severity and blocking
behavior are unchanged. See [Trivy database configuration](https://trivy.dev/docs/latest/configuration/db/).

Once scanning ran, it found two high-severity `brace-expansion` advisories in
the API image's application dependency tree. The root overrides now require
patched versions within the existing package majors; the lock resolves 1.1.21,
2.1.7 and 5.0.12. No vulnerability waiver or scan downgrade was added. See the
maintainer's [nested-group advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7)
and [comma-parser advisory](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p).

The native package version is intentionally not bumped ahead of a release tag.
No new APK release, OTA rollout or hardware PASS is claimed here. Follow
`apps/player/HARDWARE-QUALIFICATION.md` and `docs/player/HARDWARE-QUAL-CHECKLIST.md`;
a fresh release must be physically qualified or use an explicitly authorized,
logged hotfix override. Include the newly observed rk3328/Android-11 class in the
matrix before its release. An offline device still needs power/network restored
before it can receive any web refresh or APK command.

For field validation, restore the disconnected box, capture its OS/WebView and
exit diagnostics, run the same original file alone before multi-video playlists,
verify frame progress and loop seams on the physical screen, force a renderer death
on a bench build, and test repeated interruptions using a synthetic test file.
Use the existing qualification procedure for its unchanged alert checks; this
change does not authorize or schedule a live emergency drill.
