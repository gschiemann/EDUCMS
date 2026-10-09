# Native video field comparison

This is an **unqualified, explicitly enabled field path** for a front/rear Android LCD pair. It is not a stable fleet release or a claim of smooth playback. The default `PLAYER_NATIVE_DUAL_VIDEO` is empty; normal screens retain their current player. Build and test only against the accounts authorized for this investigation: Brookfield and Vision Core.

The native path uses one hardware `MediaCodec` directly into each face's own `SurfaceView`. It does not lower the selected file's dimensions, frame rate, or bitrate. Both faces must independently fetch their own authenticated manifest, agree on the exact selected file and session, and surrender their HTML decoders before native allocation. A descriptor disagreement, revoked/changed credential identity, lost page lease, missing surface, or output stall retires the pair and restores browser playback. Emergency holds always retire normal native video.

## Private candidate build

The stable catalogue remains 1.1.24. Future stable Player releases must exceed the candidate install code (for this candidate, use 1.1.26 or higher).

Run the existing Android Player APK workflow manually with `playerFieldCandidate=1.1.25-field.1`. The candidate is production signed, has install code 10125, and is uploaded as an Actions artifact. It does not create a release tag, publish storage APKs, or change the fleet's latest stable version. Never reuse a stable version for different APK bytes. Keep the Actions run, commit, APK digest, certificate fingerprint, and installed version with the field evidence.

## Comparison sequence

1. Record at least three full baseline telemetry intervals for both faces: actual file URL/hash, dimensions, sync state, frame/drop counts and loop stalls. Keep source pixels, frame rate, orientation, content assignment, and sync configuration unchanged.
2. Install the signed candidate on the authorized test box. Remote delivery uses a committed, verified provenance record, a private digest-named APK mirror, and the temporary `PLAYER_APK_FIELD_*` exact-tenant/ID window. It requires the existing authenticated operator push and preserves maintenance-window, canary, signing and quarantine checks; it cannot be triggered by tenant auto-update. The short download ticket is separate from the stable download attribution tag. Confirm **both** face rows report the candidate and keep their independent credentials. This step requires a real device install; a successful APK build is not device proof.
3. Write an `AuditLog` before adding only the two authorized screen IDs to `PLAYER_NATIVE_DUAL_VIDEO`. Check the actual manifests before interpreting telemetry. A single face, OWN rear assignment, mixed/time-window content, sync group, emergency, canvas override, unsupported source, or mismatched file is deliberately excluded.
4. Measure deltas of each face's own `lastVideoReport.native.output.uniqueFrames` against elapsed time, fresh callback age, codec name and loop count. HTML frame/drop counters remain dated by their original `lastVideoReportAt`; never relabel old counters as native smoothness or infer zero drops from readiness. First-frame callbacks and cumulative counters alone do not prove sustained 30 fps.
5. Cover at least three settled intervals and two complete source loops. Require the full frame rate on **both** attached visible outputs without periodic multi-second waits; confirm orientation/quality on the glass when a person is available. Run the hardware checklist's offline/content-update and emergency drill on an authorized test unit before qualifying a release.
6. If the comparison fails or ends, audit and clear the exact field flag. Confirm normal manifests, continuing browser output, and unchanged stable release catalogue. A device running a higher private candidate cannot ordinarily downgrade to 1.1.24; disabling the optional renderer restores its normal browser behavior without a downgrade.

`native.output` is evidence from Android's own Surface render callbacks, not a photograph or proof that the physical display is illuminated. No REQUIRED hardware qualification row may be marked PASS from mocks, CI, or these counters alone.
