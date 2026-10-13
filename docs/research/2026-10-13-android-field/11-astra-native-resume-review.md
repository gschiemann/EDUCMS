# Native resume review — 2026-10-13

Scope: read-only source diagnosis of the two authorized Android 13 primary panels on 1.1.34-field.1, using the lead's fresh field observations. No code edits, app runs, builds, deployments, new agents, or independent live-device queries. Source checkout: `/Users/gschiemann/.codex/worktrees/android-field-recovery/EDU CMS`, reviewed HEAD c20f9db3. API playback-config compatibility changes are outside this review.

## Standard Audit Surface coverage

C = covered within this narrowly stated scope; N/A = outside this diagnosis. Covered does not claim a fleet or physical qualification.

| # | Surface | Design | UX | Functionality |
|---|---|---|---|---|
| 1 | Real-time + signed pub/sub | N/A | N/A | N/A |
| 2 | Storage + content pipeline | N/A | N/A | C: existing file-fault block preserved |
| 3 | AI providers | N/A | N/A | N/A |
| 4 | AI feature surfaces | N/A | N/A | N/A |
| 5 | AI comparative scan | N/A | N/A | N/A |
| 6 | Streaming integrations | N/A | N/A | N/A |
| 7 | Sports integrations | N/A | N/A | N/A |
| 8 | POS integrations | N/A | N/A | N/A |
| 9 | Communications | N/A | N/A | N/A |
| 10 | Auth + identity | N/A | N/A | C: existing descriptor/credential checks retained |
| 11 | Billing | N/A | N/A | N/A |
| 12 | Design import | N/A | N/A | N/A |
| 13 | Public alerts | N/A | C: alert precedence | C: existing native hold gates inspected |
| 14 | Multi-vertical | N/A | N/A | N/A |
| 15 | Cross-browser + Chromium-83 | N/A | N/A | C: SDK33 field lane only |
| 16 | Forensic / audit | N/A | N/A | C: distinguish native vs browser evidence |
| 17 | Operational + DX | N/A | N/A | C: lifecycle / recovery |
| 18 | Accessibility | N/A | C: native/remote UI retains ownership | N/A |
| 19 | Template editability | N/A | N/A | N/A |
| 20 | Design/UX/functionality lenses | C: ownership model | C: seamless recovery constraints | C: pause/resume chain |
| 21 | Verification discipline | N/A | N/A | C: source diagnosis; physical acceptance deferred to lead |

## Decisive finding

The reported M43 drops do not currently measure the Android native decoder. Native did engage on both .34 devices, then Android Activity pause destroyed their native sessions. The web policy deliberately keeps the same content on browser video after that event, and no native resume path re-engages it.

Field evidence supplied by the lead, not re-queried by this reviewer:

- L55 first native above-window log: 20:18:06.611Z; `activity-paused next=stay attempt=0 proto=2 face=0 stage=presenting` at 20:19:39.544Z.
- M43 first native above-window log: 20:19:13.337Z; same pause fallback at 20:19:36.801Z.
- Runtime observations include foreground/interactive true, but those observations and fallback timestamps must be aligned per device; the supplied 20:19:38 runtime observation predates L55's 20:19:39 fallback. They are not proof of every later lifecycle state.
- Later video reports contain no native block and contain `loop.backend=native`, `evidence=rvfc`, and `continuous:blocked`; M43 records 11 drops / 1008 frames (~1.09%) and two brief stalls. This establishes browser-video drops after native fallback; it does not establish why the browser dropped those particular frames.

The misleading vocabulary is explicit in `apps/web/src/app/player/loopEligibility.ts:1-12`: “native” in the loop subsystem means the browser's built-in HTML video loop. `telemetry.ts:160-170` specifies rVFC loop evidence. Android native telemetry is a separate object assembled from `nativeSharedVideoEvidence.telemetry()` in `page.tsx:7696-7703`. Do not infer Android decoder use from `loop.backend=native`, and do not clear a native codec block because the browser continuous-loop guard says `continuous:blocked`.

## Exact failure chain

1. `MainActivity.onPause`, `MainActivity.kt:4184-4210`, unconditionally invokes `SharedVideoHost.suspendAll()` before setting `isInForeground=false`. This happens on every Activity pause; there is no classification of the initiating cause in this call.
2. `SharedVideoHost.kt:115` suppresses both engines with `activity-paused`. `FaceVideoBox.suppress`, `FaceVideoBox.kt:112`, retires sessions. `stopSession`, lines 435-454, marks the session dead, retires its layer, stops its renderer, reports `failed` plus the reason, hides/removes the elevated surface, and restores an opaque web background. This is a full retirement, not an ExoPlayer-style paused session waiting to play again.
3. `SharedVideoController.poll`, `nativeSharedVideo.ts:765-768`, sees failed and calls `fail(reason)`. `fail/stop`, lines 690-707, cancel its timer and controller permanently for that attempt.
4. `NativeDualVideo.tsx:200-212` clears native evidence and remounts browser children. `nativeVideoNext`, lines 27-42, returns `stay` for every transient or missing reason once handoff or presenting has occurred. The caller passes true already at `seen=ready` (the handover stage), not only after actual presenting. `activity-paused` is transient (`nativeSharedVideo.ts:322-337`), so the field's exact `next=stay` follows directly.
5. There is no identity change when the same manifest is fetched again; the effect depends only on identity (`NativeDualVideo.tsx:218-229`). Parent re-renders therefore do not recover native.
6. `MainActivity.onResume`, lines 4023-4050, sets foreground true and resumes WebView/timers. The remaining onResume logic through line 4182 handles lock task, display/emergency refresh, faces, and setup UI; it never re-prepares the retired solo native session. `onWindowFocusChanged`, lines 5020-5023, only reapplies immersive UI.

This behavior was intentional protection against repeated web/native flipping, reflected in `nativeVideoEngine.test.ts:185-199`. Removing the post-handoff `stay` rule wholesale would reintroduce the original problem.

## What caused the Activity pause?

The supplied pause reason does not answer that. This branch runs for every Android Activity pause. The code recognizes sleep separately by querying `PowerManager.isInteractive` and setting `lastPausedBySleepAtMs` (`MainActivity.kt:4193-4200`), and setup-related departures are recorded separately by `SetupCeremony.noteHostPaused` (4192). Neither distinction is included in the native video fallback reason. A remote Back inside this app instead calls `yieldToUi` and dispatches `edu-show-stop-overlay` (`MainActivity.kt:1864-1872`), whose native reason is `page-stopped`. Therefore “the user pressed the remote” is not justified by `activity-paused`. Establishing the initiator requires correlated lifecycle/power/setup/OTA logs around the exact timestamps.

## Minimal .34 web-only candidate, and its real limits

A narrowly gated web correction can re-engage .34 with the existing prepare/commit/state methods. Treat an exact protocol-2 `activity-paused` failure as a pending lifecycle recovery ticket, separate from ordinary retry and separate from file fault blocks. Preserve `stay` for all other post-handoff transient/unknown reasons. Keep a bounded per-identity attempt budget, unchanged identity checks, and do not mutate the block-key version or remove real codec/digest/file-fault blocks.

The ticket may permit one recovery attempt when the document is visible and `document.hasFocus()` is true. Listen for focus/visibility return, and immediately evaluate the current state when the failure is observed: native may already have resumed before the controller polls the retired session, so waiting only for the next focus event can leave it stuck forever. Debounce/settle the observation, cancel on blur/hide/unmount/identity change, and recheck eligibility before prepare, before executing the loop-boundary handover, and before commit. A timer is only a bounded debounce/backoff for a pending ticket; it must not create recurring 30-second decoder attempts while backgrounded.

Preserve the existing browser loop-boundary handoff (`NativeDualVideo.tsx:153-183`) and hold frame / decoder release / React-unmount-before-commit ordering (112-144, 231-235). Do not restart the whole page, issue wake/brightness commands, or reset the native failure store. On a canceled recovery, remove boundary listeners as well as its timeout so an old ready callback cannot later detach the browser video. The current fallback does not clear an already-armed boundary timer; implementing lifecycle cancellation should avoid carrying that stale callback into a new attempt.

Existing safety gates remain valuable: `page.tsx:12579-12585` removes native eligibility for inactive playback, update UI, blank/dim, editor/touch UI, and emergency. Native `FaceVideoBox.commit` (302-315) and first-frame promotion (392-407) recheck emergency and `host.canOwnWindow`; the continuous watch also yields (419-429). `SharedVideoHost.prepare` (65-71) clears the operator-request latch on a new solo prepare, but `operatorUiClear` remains required at commit/promotion. Never bypass these gates.

However, source inspection cannot certify that this web-only candidate satisfies **every foreground + native UI-clear return**:

- `SharedVideoHost.canOwnWindow` (`SharedVideoHost.kt:51-58`) combines the operator-request latch and the native UI predicate. `MainActivity.kt:2488-2493` checks setup/boot card, manager gate, blackout, recovery overlay and URL overlay. It does **not** check `isInForeground`, interactivity, or window focus.
- `sharedVideoState` reports session/output data, not Activity foreground or native UI readiness (`FaceVideoBox.kt:481-492`). A failed session remains readable 30 seconds and then disappears; neither failed nor idle proves ready to resume.
- `deviceInfo` (`MainActivity.kt:4020`) likewise does not supply foreground/UI-clear. `displayCapabilities` supplies persisted blank/brightness and emergency hold (`DisplayControlApi.kt:69-110`), not native UI ownership. The diagnostic `probeDisplay` includes power interactivity but is not a lifecycle/UI readiness contract.
- A native overlay can still be present at the first recovery attempt. Its commit gate correctly rejects with `page-stopped`, but a one-shot activity recovery may then stay web after the overlay clears. Generalizing page-stopped into blind periodic retries is not an acceptable fix.

Consequently: a scoped .34 web candidate is reasonable only with physical confirmation that these devices reliably deliver the needed focus/visibility changes and that the recovery gate does not consume its only opportunity behind native UI. It must not be reported as deterministic native-lifecycle recovery from source evidence alone.

## Deterministic correction if those .34 signals are insufficient

For the full requirement—resume after the Activity is foreground **and** actual native UI is clear without background spin—use a private .35 readiness contract. Prefer additive fields on the existing `sharedVideoState` response over a new privileged bridge command: native Activity-resumed/interactivity, a UI-availability predicate, and a monotonically changing readiness/resume epoch. Compute those facts natively. Update/read them on the UI thread; do not read Android View properties unsafely from a bridge worker. A native event can wake the web wait but must be paired with queryable state/epoch so event ordering cannot lose recovery.

Keep the current explicit operator-request latch intact. If availability is reported separately, it should describe the physical UI predicate before the latch; an eligible fresh web prepare may then clear the latch through the existing path. Blindly returning `canOwnWindow` as the only readiness flag would deadlock recovery after `yieldToUi` because prepare is what currently clears its latch. Conversely, clearing the latch on every focus change would cover a still-active web Stop overlay and is unsafe.

Strengthen the actual native ownership predicate to require resumed/interactivity in addition to existing UI/emergency rules, including at commit and first-frame promotion. `onPause` must set the resumed gate false before retiring sessions, closing a queued-prepare race. Do not have native autonomously resurrect a retired decoder: web remains responsible for current descriptor eligibility, browser decoder release, and loop-boundary handover. A web ticket consumes each ready epoch at most once. A new genuine pause/resume is a new opportunity; unrelated polling is not.

No auth, descriptor ownership, file SHA verification, emergency hold, audit, or manifest logic needs weakening. Keep fleet .29 unchanged; a .35 APK, if selected, is private to the two explicitly authorized panels.

## Required acceptance checks for the lead

Target tests should prove: post-presenting activity pause waits; resume-before-fallback is not missed; hidden/unfocused state never prepares; native UI/blank/dim/emergency never gets covered; one ready epoch yields at most one attempt; real codec/digest blocks survive; identity/unmount cancels waits and boundary callbacks; protocol 1 and other transient policy remain unchanged.

Physical qualification on both panels must show native first-frame above-window plus fresh advancing native telemetry, pause into real native/system UI, remain correctly yielded while it is open, return to native once clear, and repeat without a restart loop. Exercise blank/dim and trigger/all-clear with the authorized test process, confirm four-edge fill/no white regression, and observe enough playback loops to compare native drops/stalls. A browser rVFC drop counter is not the acceptance metric for Android native recovery. CI and APK provenance alone do not prove this lifecycle flow on glass.

No tests or physical checks were run by this read-only reviewer. The lead owns implementation, deployment, CI, and device acceptance.
