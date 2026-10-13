# Vision native playback investigation — Astra

## Scope and mandatory coverage

Read-only investigation at source commit `44a608e8`, isolated branch `codex/vision-native-astra-review`. Target is provisionally VisionCore “Venue-OS Media Player”, screen `13eb0b62-d420-4517-922e-e17700716fae`; historical inventory X80/RK3328 Android 11, identity confirmation pending. This is not an app-wide audit or hardware qualification. “Covered” means reviewed within this incident scope, not a PASS. No production/device commands, environment changes, credential changes, deployments or code fixes.

| # | Standard Audit Surface | Design | UX | Functionality | Scope / deferral reason |
|---|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | Deferred | Covered | Covered | Only native emergency stop/overlay boundary; full transport drill deferred. |
| 2 | Storage + content pipeline | Deferred | Covered | Covered | Descriptor selection, authenticated native fetch, verified disk cache and fallback. |
| 3 | AI providers | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 4 | AI feature surfaces | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 5 | AI-tool comparative scan | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 6 | Streaming integrations | Deferred | Deferred | Deferred | Target is a local verified MP4, not a live stream. |
| 7 | Sports score / data integrations | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 8 | POS / commerce integrations | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 9 | Communications integrations | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 10 | Auth + identity | Deferred | Covered | Covered | Device identity/credential and manifest boundary only. |
| 11 | Billing + commerce | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 12 | Design import integrations | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 13 | Public alert integrations | Deferred | Deferred | Deferred | External integrations outside scope; native emergency boundary covered in 1. |
| 14 | Multi-vertical surface | Deferred | Deferred | Deferred | Outside this device-video incident. |
| 15 | Cross-browser + Chromium-83 | Covered | Covered | Covered | Android native/WebView compositing; Taurus excluded; fleet browser matrix deferred. |
| 16 | Forensic / audit coverage | Deferred | Covered | Covered | Playback evidence and missing diagnostic states; no privileged actions executed. |
| 17 | Operational + DX | Deferred | Covered | Covered | Private APK/version/bundle claims and reproducible field-test design. |
| 18 | Accessibility + a11y | Deferred | Covered | Covered | Above-window surface implications for remote escape/control; full a11y deferred. |
| 19 | Template + Widget Editability | Deferred | Deferred | Deferred | Explicitly excluded; no template edits. |
| 20 | Design + UX + Functionality lenses | Covered | Covered | Covered | Applied to this narrow investigation only. |
| 21 | Verification Before Claim | Covered | Covered | Covered | Source/platform evidence separated from actual device/glass confirmation. |

## Findings

A definite implementation error exists in the most recent attempted visibility fix. `FaceVideoBox.kt` uses `setZOrderMediaOverlay(true)` for protocol 2 while its comment and commit say the video sits above the WebView. Android explicitly defines that method as raising a SurfaceView above other ordinary SurfaceViews while keeping it behind the app window. It does not eliminate WebView/window opacity. `setZOrderOnTop(true)` is the distinct above-window method.

Official primary source: https://developer.android.com/reference/android/view/SurfaceView#setZOrderMediaOverlay(boolean). This establishes wrong API semantics, not yet the current device's gating state or a verified hardware fix. The proposed controlled test must distinguish native not attempted from native decoding but hidden.

The lead's fresh 2026-10-13 05:43Z device snapshot shows player `1.1.33-field.1` (10133), recent heartbeat, and browser frame telemetry with `loop.backend: native`, `evidence: rvfc`, and no nested `lastVideoReport.native`. “Native” in the browser loop report means HTMLVideoElement repetition; it is not MediaCodec proof. `native_runtime_report` contains process/power fields only. The fresh configuration read below now explains the current browser path. Historical logs are still needed to determine the precise state of the failed native test.

### 1. Current native playback is deliberately excluded — proven current cause

The lead's fresh read of Railway configuration reports `PLAYER_NATIVE_VIDEO` contains `-13eb0b62-d420-4517-922e-e17700716fae`. In `apps/api/src/screens/native-video.ts:122`, screen exclusions return false BEFORE the positive ID/model/all checks at line 124. `screens.controller.ts:7221` only builds the descriptor for enrolled screens. Both protocol-2 and protocol-3 native descriptors use this enrollment policy. The current private APK cannot override it.

Executed `reproduce-rollout.cjs` against the repository's actual TypeScript function, exact target ID and generic-android model:

| Input configuration (minimal reproduction, not complete live env) | Enrollment |
|---|---|
| `all` | true |
| `all,-13eb0b62-d420-4517-922e-e17700716fae` | false |
| positive ID followed by negative same ID | false |
| `faces,model:generic-android,-13eb0b62-d420-4517-922e-e17700716fae` | false |

This is a rollback/containment state, not proof that the hardware cannot decode. Leave the exclusion in place until a scoped next test is authorized. No environment variable was changed.

### 2. Last visibility fix selected the wrong Android layer — definite source defect

`apps/player/app/src/main/java/com/educms/player/media/FaceVideoBox.kt:242` uses `setZOrderMediaOverlay(true)`. Its comments and commit `e68dab3b` promise solo video ABOVE the page. Android's contract does not do that: media-overlay changes ordering relative to other media surfaces, while remaining below the app window. The WebView's opaque drawing can still cover it. The container is also explicitly inserted before the WebView child. Changing this API did not remove the opacity dependence identified by the preceding field test.

Primary platform verification:

- [Official SurfaceView API](https://developer.android.com/reference/android/view/SurfaceView#setZOrderMediaOverlay(boolean)): media-overlay remains behind the containing window; `setZOrderOnTop` is the separate above-window operation.
- [Android 11 source](https://android.googlesource.com/platform/frameworks/base/+/refs/tags/android-11.0.0_r1/core/java/android/view/SurfaceView.java): fetched read-only and examined the two implementations. The first selects the media-overlay sublayer; the second selects top ordering and enables dynamic changes for targetSdk above Q. This app targets 34.

The source comment reports the earlier VisionCore test decoded approximately 29.8 fps with visible=true while the glass stayed white. That comment is historical testimony, not a fresh device measurement. It supports a composition failure but must be correlated with the actual diagnostic/glass observation before claiming the precise original cause is closed.

`FaceVideoBox.kt:432` defines visible as attached + `isShown` + window visibility. It does not test occlusion by another view/window or sample the physical display. `updated` records MediaCodec frame callbacks. Those are decoder/surface progress evidence, not proof the user saw those pixels. The API's native proof gate uses the same facts (`telemetry.controller.ts:435`). This explains how healthy native telemetry can coexist with white glass without implying telemetry transport is broken.

### 3. The diagnostic path can discard the useful failure — definite observability defect

`page.tsx:12588` logs SKIPPED once per document if either a descriptor OR a protocol reply exists. A descriptor can arrive before protocol negotiation, or a protocol reply before the descriptor. The logged skip can therefore be a normal startup state. It never resets when either later becomes ready. The same render branch may be evaluating an inactive slide.

`MainActivity.kt:3138` persists only one playback warning per 60 seconds; `NativeDualVideo.tsx:54` requests upload after 3 seconds and then throttles uploads for ten minutes. Therefore a startup SKIPPED can consume the persistent-log budget, the automatic upload can happen before a later native end, and the actual FALLBACK can disappear from uploaded evidence. Native `stopSession` itself has no durable reason logging.

This does not cause hidden video. It does explain why repeated tests can fail without yielding the decisive reason. Do not treat missing FALLBACK lines in a three-second upload as proof no prepare/commit happened. Proposed instrumentation, if approved for implementation: persist one sanitized native terminal transition per session, with session/build/face/stage/reason; give terminal native failures a distinct logging budget from benign eligibility snapshots; delay eligibility snapshots until both descriptor and protocol states are resolved, or log changes by a bounded gate signature. Never log tokens or signed URLs.

## Traced path and remaining evidence

| Stage | Source trace | Current/historical conclusion |
|---|---|---|
| API enrollment | native-video.ts -> screens.controller.ts | Current explicit exclusion prevents per-face descriptor emission. |
| Playlist winner | nativeVideoWinner / nativeVideoCandidate | Latest source selects first REPLACE; earlier multi-playlist rejection was changed in 131fbbd6. No reason to repeat that patch. |
| Web selection | page.tsx -> pickNativeVideo -> sharedVideoEligible | Requires descriptor, protocol >=2, no build-specific block, same asset/hash, solo/muted/active, no sync/emergency/preview. |
| Probe | sharedVideoState once plus one retry | Latest APK reports protocol 2 + protocolMax 3; transient bootstrap null is not final state. |
| Cache block | edu.nativeVideo.block.v3 + hash/face/APK build | A block from an older APK does not carry across a new versionName. Same-build block can persist 24h. Current exclusion precedes this issue. |
| Bridge | nativeBridge arrays -> NativeBridgeChannel METHODS/dispatch -> WebAppBridge -> SharedVideoHost | Four existing methods; no new contract needed. Origin/main-frame/nonce gates remain intact. |
| Native authorization | SharedVideoSource.manifest -> FaceVideoBox.select | Native reads its own face token, proves screen identity, fetches own authenticated manifest, compares revision/hash/asset. |
| Native bytes | verifiedFile | Separate native disk cache; length/SHA256 verified before use. Browser cached=true does not prove this cache. |
| Prepare | FaceVideoRenderer.prepare -> attachSurface -> ready | Hardware AVC chosen; decoder not allocated until page yields. Surface is already attached before ready. |
| Handover | NativeDualVideo.ready -> loop boundary <=60s -> browser decoder release -> commit | Readiness alone is not a displayed native frame. |
| Decode + compose | create/configure/start -> rendered callback -> SurfaceView | Wrong layer API preserves opacity dependence; callback/visible flags cannot disprove occlusion. |
| Fallback | SharedVideoController -> nativeVideoNext | Terminal faults can block 24h; after handover a transient end stays web for the document to prevent oscillation. |
| Emergency | DisplayEmergency.ensureVisible -> suppressForEmergency; native watch | Hold stops sessions; surfaces removed on main-thread post; do not change hold/auth/HMAC/fallback semantics. |

## Decisive next test, not another broad rollout

Stage 1 executed no device commands, deployments or config mutations. The next test is a narrow diagnostic on the physically confirmed X80 only, preserving the same bytes, assignment, APK baseline and emergency boundaries.

1. Record the failed test's exact APK/web bundle, descriptor revision/hash, native session, prepare/ready/commit/presenting/failure and on-glass observation on one timeline. Current production config is disabled, so looking only at fresh heartbeat will never reproduce the native failure.
2. If this earlier evidence is unavailable, prepare one private diagnostic build with bounded native lifecycle logging. If testing the composition repair on API30, keep the surface below the window while preparing; after page commit and preferably the first decoded-frame callback, promote the solo surface with the genuine above-window API. Preserve protocol-3 positioning under the page. Record the promotion timestamp. Do not change codec/file/network rules in this comparison.
3. Do not replace the call at attach with `setZOrderOnTop(true)` blindly. Surface attachment happens before native readiness and the browser may wait up to 60 seconds for its loop point. A top surface there can cover ongoing browser video with an uninitialized black surface. Android 11 + targetSdk34 supports changing top ordering after creation, so promote at the deliberate handoff, with native failure/stop cleanup.
4. The above-window API also covers all UI in the app window. Prove the existing escape/stop/setup/info and emergency paths explicitly retire/demote it before those surfaces must be seen. Stop marks the session dead before queueing view removal, so a queued promotion must recheck liveness/hold. This is a required review and physical emergency trigger/all-clear test before accepting the approach, not permission to weaken any safeguard.
5. With the lead's scoped authorization, temporarily enroll only the target and remove only its negative token for the test. On-glass A/B outcome: if native counters advance in both runs but picture appears only after actual layer promotion, the composition defect is isolated. If native never reaches ready/presenting, capture the precise terminal reason and fix that gate first; layer changes cannot repair enrollment/auth/cache/codec failures.
6. Acceptance: actual moving picture at the correct crop/orientation; three consecutive native reports with advancing uniqueFrames/PTS and loops; no white/black interval outside the measured handoff; emergency trigger/all-clear visible; D-pad escape actionable; same verified file on browser fallback; no repeat web/native oscillation. Keep stable fleet unqualified until the full hardware matrix is complete.

This stage delivers a confirmed reason for the current browser behavior and a confirmed defect in the attempted composition fix. It does not yet claim the last hardware failure was reproduced or repaired.

## Executed verification

- `pnpm --filter api exec jest --runInBand --runTestsByPath src/screens/native-video.spec.ts`: 29/29 pass. Includes exclusion precedence and first-REPLACE winner.
- `pnpm --filter web exec jest --runInBand --runTestsByPath src/app/player/__tests__/nativeVideoEngine.test.ts`: 16/16 pass. Protocol, eligibility, retry, cache-block scope and diagnostics contracts.
- `node docs/research/2026-10-12-vision-native-astra/reproduce-rollout.cjs`: four exact-ID assertions pass.
- Official Android API and Android 11 AOSP implementation agree on layer semantics.
- No Android emulator/physical run, no glass claim, no APK build, no deploy. Pure JS tests cannot exercise Android SurfaceView composition.
- A first convenience attempt with `pnpm exec tsx` could not run because this checkout has no tsx binary. The saved reproduction instead uses the installed TypeScript transpiler; no dependency was added.
