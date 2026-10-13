# Vision native playback investigation — Astra

## Scope and mandatory coverage

Read-only investigation at source commit `44a608e8`, isolated branch `codex/vision-native-astra-review`. Target is user-confirmed VisionCore “Venue-OS Media Player”, screen `13eb0b62-d420-4517-922e-e17700716fae`; historical inventory X80/RK3328 Android 11. This is not an app-wide audit or hardware qualification. “Covered” means reviewed within this incident scope, not a PASS. No production/device commands, environment changes, credential changes, deployments or code fixes.

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

The lead's fresh 2026-10-13 05:43Z device snapshot shows player `1.1.33-field.1` (10133), recent heartbeat, and browser frame telemetry with `loop.backend: native`, `evidence: rvfc`, and no nested `lastVideoReport.native`. “Native” in the browser loop report means HTMLVideoElement repetition; it is not MediaCodec proof. `native_runtime_report` contains process/power fields only. The fresh configuration read below now explains the current browser path. The historical 22:26 UTC event, incorporated below, proves this video reached native presenting before Activity pause ended its session.

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

The source comment reports the earlier VisionCore test decoded approximately 29.8 fps with visible=true while the glass stayed white. The new historical log independently proves native reached presenting before pause; the white-glass observation still comes from the prior field-test record/comment rather than a fresh physical observation. Exact APK at the historical event and the actual occluding layer remain unproven.

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

## Historical evidence follow-up — 2026-10-13

Target identity is now explicitly confirmed by the user. Read the lead's saved, scoped `PLAYER_RECOVERY_EVENT` rows in `2026-10-12-vision-native-live-audit.json` (copied alongside this report). That action name matters: searching only for a hypothetical `PLAYER_DIAGNOSTICS` action would miss these entries. The saved read is stamped 2026-10-13 05:50Z and contains 12 selected rows.

### What happened, in event time rather than upload time

| UTC on October 12 | Evidence | Interpretation |
|---|---|---|
| 13:28:12 | Source commit `1d19fc96` | Deliberate owner requirement: after native handoff, no repeated web/native switching; transient ends stay web for the same document/content. |
| 16:53:37–17:02:38 | Ten manifest HTTP 403 event times; several uploaded much later | Earlier auth/manifest gate. Uploads at 18:10 and 20:03 do not mean fresh 403s then. |
| 17:20:49 | Source commit `3698181f` | Token newer than cached credential snapshot forces fresh auth read. Commit time is not deployment time. Lead reports this later shipped; no basis to diagnose today's failure using those earlier 403s. |
| 18:10:02.429 | `SKIPPED desc=no proto=3 choice=no solo=true muted=true active=true ... sync=false preview=false emergency=false` | APK protocol was usable but the page had no descriptor at that moment. This is an upstream selection/enrollment state, not decoder failure. The row does not uniquely distinguish absent API descriptor from local parse refusal or initial timing. |
| 19:59:03 | Source commit `131fbbd6` | First-REPLACE winner repair postdates that skip. This fits the previously documented two-playlist selection failure; the old log alone cannot prove its sole cause. |
| 22:15:01 | Source commit `e68dab3b` | Media-overlay layering change. |
| 22:21:44 | Source commit `15f35cc8` | Private 1.1.33-field.1 registered. Registration alone does not prove installed version five minutes later. |
| 22:26:45.578 | `FALLBACK reason=activity-paused next=stay attempt=0 proto=2 face=0 sha=331a260d stage=presenting` | This video had reached native presenting; Activity pause ended it; explicit page policy selected browser for the rest of this attempt identity. Uploaded 22:26:49.262. |
| October 13 05:43Z onward | Current private APK10133/web3698181 heartbeat, browser rVFC sample; fresh rollout includes target exclusion | Current state is explicitly disabled. It must not be used to judge whether the earlier native decoder started. |

The 22:26 row is chronologically compatible with 1.1.33 but contains no APK, web build, full digest, session ID, revision, or codecName. `proto=2` denotes this solo controller path even when the APK advertises protocolMax=3. Do not relabel the event as a proven 1.1.33 failure or infer exact hardware model from it. The eight-character digest identifies the logged test prefix, not a cryptographic full-file identity.

### What `stage=presenting` actually proves

`NativeDualVideo.tsx:189` sets the sticky local `seen` variable to `presenting` ONLY after its controller delivers `fresh=true`. `SharedVideoController.poll` requires a committed matching native session with state `presenting`, attached and visible output flags, age no greater than 2500ms, positive advancing uniqueFrames and nonzero viewUpdates. Native updates originate in the MediaCodec frame-render callback; there is no browser rAF path into this counter.

Thus the event proves the page previously received fresh native rendered-frame evidence for this requested digest prefix. The path had progressed past enrollment, descriptor parsing, bridge prepare, native authenticated selection, verified disk file, hardware codec preparation, commit and actual rendered callbacks. It refutes “Android native never engaged” for this historical attempt. It is stronger than merely `ready` or a running process.

It does NOT prove on-glass visibility, lack of occlusion, sustained full-rate playback, a loop boundary, or exact codec choice. `seen` is sticky: the termination line says the attempt reached presenting sometime before the pause, not that the frames were still fresh at the instant the log was written. `visible` is a View/window flag, not a physical camera observation. A compositor-covered surface can satisfy these flags.

### Why `activity-paused` became `next=stay`

There is one caller of `SharedVideoHost.suspendAll()` in current source: `MainActivity.onPause` at line 4175. The host suppresses sessions with reason `activity-paused`, and `FaceVideoBox.stopSession` retires the renderer. The cause of the OS pause is not carried by this line: sleep, an installer/settings Activity, another application or other lifecycle interruption remain unproven. Do not call it a codec crash.

The web controller receives the terminal native reason. `nativeVideoNext(2, 'activity-paused', 0, true)` returns `stay`: the `wasOnGlass` branch intentionally runs BEFORE the transient-retry branch. `activity-paused` is transient, so it does not create a file block. The fallback cancels controller polling, mounts browser playback, and does not schedule an attempt increment. The component's effect is keyed only on descriptor identity plus attempt; unchanged manifest polls or an ordinary rerender do not restart it. `MainActivity.onResume` resumes WebView/timers but has no native-video re-prepare. There is no resume/visibility listener in NativeDualVideo that advances attempt.

This is a reproducible document-lifetime native-disable after a routine pause. It is **not a permanent device disable and not the 24-hour bad-file block**: a genuine component remount, changed descriptor identity or fresh document can try again if enrollment still permits it. It was deliberately introduced to obey the user's no-oscillation requirement, as the commit message and tests confirm. It nevertheless means “resume the Activity” does not imply “resume the native engine.” If native resumption is a product requirement, that is an overly broad lifecycle policy requiring an explicit foreground-session design, not permission to re-enable a generic 30-second retry. In this incident it explains post-pause browser mode; it cannot explain why the earlier presenting image looked white before the pause.

### Priority and one controlled correction

The immediate diagnosis is now concrete: earlier 403/no-descriptor gates were followed by a native attempt that DID render frames; then Activity pause plus deliberate stay policy ended native for that document; the current rollout exclusion independently prevents another attempt. The claimed above-page fix never actually put the surface above the app window.

Prioritize one private diagnostic correction: the actual solo-surface layer transition. Keep current no-oscillation/retry behavior in that build, and keep the current production exclusion until the lead scopes the single-device test. Changing both retry and composition would confound the result and could recreate the disruption the user prohibited.

On confirmed Android 11, promote the protocol-2 surface with actual above-window ordering only after commit and a valid first native frame, with a liveness/emergency recheck on the UI thread. Keep preparation behind the page, because it may take up to a loop boundary and an uninitialized top surface would cover browser video. Remove/demote on every native stop before any required emergency or operator UI; do not allow delayed promotion after retirement. Leave protocol-3 zones under the page. Add a bounded per-session lifecycle record (`prepared`, `committed`, `firstFrame`, `layerPromoted`, terminal reason, pause/resume episode/build), with identity/hash prefixes and no credential or signed URL.

One physical experiment, after scoped authorization:

1. Start one fresh page/foreground episode with the existing verified video and the diagnostic layer correction, temporarily enabling only the confirmed target. Capture native frame and layer-transition timestamps together with the physical picture. No settings/installer navigation during this first observation.
2. If advancing native frames coincide with picture appearing only after genuine above-window promotion, the composition hypothesis is confirmed. If no native frame arrives, use its exact terminal gate; do not change retry policy to hide it. Observe at least two loops and three native reports.
3. While it is visibly native, run the required emergency/clear and remote escape checks. Surface retirement must expose the alert/controls and prevent a delayed re-promotion. A failure stops qualification.
4. As the final lifecycle check, perform ONE deliberate, identified Activity pause/resume. With unchanged policy the expected result is one `activity-paused / next=stay` and stable browser fallback, with no automatic return to native. This verifies the known behavior rather than misreading it as a failed layer fix. It also proves whether the operator wants a different resume contract.

If a later, separately reviewed resume improvement is warranted, the narrow criterion is one re-prepare per **verified new native foreground episode** after an `activity-paused` end, never an unbounded timer retry, never an unknown/codec/emergency failure, and never a retry based only on web document visibility. Presenting again in the same foreground episode must still remain prohibited after failure. This is intentionally not included in the first correction.

No new production code, device commands, environment changes, broad tests or deployments were performed for this follow-up. Existing software checks remain as previously recorded. Exact historical installed APK, pause initiator and the white picture's actual occluding layer still need the bounded physical experiment; all three are named uncertainties, not generic alternative root causes.
