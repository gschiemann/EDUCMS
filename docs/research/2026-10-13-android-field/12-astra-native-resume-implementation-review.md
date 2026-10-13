# Native resume implementation review — 2026-10-13

Read-only review of the uncommitted implementation in `/Users/gschiemann/.codex/worktrees/android-field-recovery/EDU CMS`. No app runs, tests, builds, edits to source, deployments, or new agents. Source line references are to the reviewed working-tree version and may move during the lead's fixes. This review covers lifecycle readiness, web recovery control, and the newly authorized DH43 adaptation; the unrelated API media-fit patch is excluded. The user has now confirmed using remotes/menus during the observed pauses.

## Audit surface coverage

C = covered only within this focused source review; N/A = outside its scope. Physical verification is deferred to the lead.

| # | Surface | Design | UX | Functionality |
|---|---|---|---|---|
| 1 | Realtime | N/A | N/A | N/A |
| 2 | Storage/content | N/A | N/A | C: fault-block preservation |
| 3 | AI providers | N/A | N/A | N/A |
| 4 | AI surfaces | N/A | N/A | N/A |
| 5 | AI comparison | N/A | N/A | N/A |
| 6 | Streaming integrations | N/A | N/A | N/A |
| 7 | Sports | N/A | N/A | N/A |
| 8 | POS | N/A | N/A | N/A |
| 9 | Communications | N/A | N/A | N/A |
| 10 | Auth | N/A | N/A | C: existing gates preserved |
| 11 | Billing | N/A | N/A | N/A |
| 12 | Design import | N/A | N/A | N/A |
| 13 | Alerts | N/A | C: precedence | C: unchanged hold checks |
| 14 | Multi-vertical | N/A | N/A | N/A |
| 15 | Cross-browser/hardware | N/A | N/A | C: SDK33 and SDK25 readiness scope |
| 16 | Forensics | N/A | N/A | C: reported evidence limits |
| 17 | Operational/DX | N/A | N/A | C: lifecycle and asynchronous state |
| 18 | Accessibility | N/A | C: operator window ownership | N/A |
| 19 | Editability | N/A | N/A | N/A |
| 20 | Three lenses | C: state model | C: interruption recovery | C: handoff gates |
| 21 | Verification | N/A | N/A | C: source review; physical tests deferred |

## Actionable blockers

### B1 — A readiness transport failure is manufactured into a lifecycle transition, creating an indefinite recovery wait

`apps/web/src/app/player/NativeDualVideo.tsx:148-154` handles all three conditions identically: null readiness response, a real native not-ready state, and document invisibility. It calls `fallback("page-stopped")`. That function retires the current prepared controller and starts `waitForReady(preparedEpoch, ...)` at line 143. The waiter requires an epoch strictly greater than the prepared epoch (`nativeVideoReadiness.ts`, `NativeVideoResumeWaiter.poll`).

Concrete sequence: native was prepared while ready at epoch 7. At the browser loop boundary—or after React has unmounted the browser decoder before commit—a single sharedVideoState query times out. Native itself remains foreground, interactive, focused and UI-clear at epoch 7. The page stops the prepared session, remounts browser playback, and then polls forever for epoch 8. No native lifecycle transition occurred, so an otherwise healthy player stays web until a person causes a new native readiness transition. A document visibility change without a native readiness transition has the same mismatch. This is directly contrary to recovering .35 reliably and reproduces the permanent fallback in a new form.

Concrete fix: distinguish unknown/transport failure from a valid native not-ready or epoch-changed observation. While waiting at the boundary, keep the browser and prepared attempt alive and perform bounded, cancellable readiness rechecks on the **same** epoch. Do not release the browser decoder until a positive gate result. For the post-unmount commit gate, define bounded retry/rollback explicitly; if rollback is required, retain a page-local bounded recovery authorization rather than waiting for a fictitious new native epoch. Handle web visibility as a separate gate that can reopen at the same native epoch, without allocating decoders while hidden. Native commit/first-frame guards remain authoritative. Do not globally relax the `epoch > afterEpoch` rule for true lifecycle tickets.

Required regression: prepare at epoch 7; inject a timeout at boundary/pre-commit; restore valid ready epoch 7; playback must either finish the original handoff or execute one defined bounded recovery, never wait indefinitely and never repeatedly prepare in the background. Also cover hidden→visible with unchanged native epoch.

### B2 — A failed initial capability query permanently downgrades a .35 attempt to old-APK behavior

`NativeDualVideo.tsx:253-258` sets `availabilitySupported = a !== null`; any null query immediately starts the old path. `queryNativeVideoAvailability` collapses a bridge timeout, rejection, malformed availability, and a legitimate older-APK response lacking availability into the same null (`nativeVideoReadiness.ts`).

Concrete sequence: the first query on a .35 device times out during startup. The second normal controller query succeeds, native plays, then the user opens an Android menu and returns. This component still has `availabilitySupported=false`; the `activity-paused` fallback takes the old post-presenting `stay` path and never uses .35's readiness epoch. A transient bridge hiccup has therefore disabled the actual fix for the remainder of this content identity.

Concrete fix: use a discriminated query result: valid supported response, valid legacy response with no availability, and unknown/error. Only a structurally valid legacy sharedVideoState response may choose compatibility behavior. Unknown/error should leave the browser playing and retry capability/readiness observation with cancellation and a bounded cadence; it must not assert “older APK.” Preserve once-proven support across attempt identities for the same native host/document. Malformed advertised availability should fail closed, not authorize old-path preparation. No new privileged bridge method is needed.

Required regression: initial timeout/rejection followed by valid .35 readiness; then presenting→pause→resume must still create exactly one lifecycle recovery. A valid .29 response with no availability must continue to take its original path.

## Safety paths inspected without an additional blocker

The Activity now publishes `isInForeground=false` and refreshes readiness before suppressing native sessions. The immutable readiness snapshot is volatile; bridge-worker refresh posts to the UI thread rather than blocking while holding the video monitor. Current calls that read `operatorUiClear` through `canOwnWindow` are reached from pre-draw, posted commit/promotion work, or the main-handler watch. Commit and first-valid-frame promotion still recheck ownership and emergency state. Operator-request latch is not used as physical UI readiness, avoiding the prepare/reset deadlock. Browser source release still precedes React unmount and native commit. Pending boundary listeners/timeouts are canceled by fallback and cleanup, and late availability replies are guarded by alive/ended state. Real native fault reasons still take the existing block path; no block-key reset was introduced. These are source observations, not physical qualification.

The new helper tests exercise the waiter and parser, but they do not execute the component paths in B1/B2. Existing 22 passing tests therefore do not resolve these two blockers. No request for a broad additional test suite: add focused regressions at the integration point where query outcomes choose the handoff/recovery policy.

## Minimal DH43 lifecycle adaptation requested during review

The user has expanded the private test scope to Brookfield DH43, both faces, SDK25, currently .29. The reported ~53.1% front / ~48.7% back frame loss is supplied by the lead; this reviewer did not re-query it. It does not by itself establish the native decoder's capacity or prove that lifecycle recovery fixes the frame rate.

1. Separate readiness support from the above-window surface workaround. Primary `MainActivity.configureWebView` can supply foreground readiness on SDK25 too; remove only the SDK33 restriction around the new foreground callback. Leave `SoloVideoLayer.eligible(protocol, face, sdk)` unchanged, including its SDK33+ primary-only restriction.
2. `FacePlayerHost.configureWebView` currently calls `SharedVideoHost.attach(faceIndex, wv)` at line 193. Supply `MainActivity.isInForeground` and an explicit secondary physical-UI predicate (host not destroyed, WebView/window attached and visible, its own recovery overlay not visible). The default operatorUiClear lambda is false, so simply adding a foreground callback would permanently prevent secondary readiness.
3. Do not require input/window focus for the secondary Presentation. Make focus requirement an explicit host policy. Prefer an additive `focusRequired` contract field and compute readiness as foreground && interactive && (!focusRequired || focused) && uiClear; update the strict web parser accordingly. Alternatively report a clearly documented focus-gate-satisfied value, but do not misdescribe it as actual observed focus. Continue requiring focus on the primary when that policy is appropriate. A Presentation being displayed is not proof it owns input focus.
4. Refresh secondary readiness in its own `onResume/onPause`, and publish false for **all** hosts before global `suspendAll`. Current `MainActivity.onPause` calls `faceHosts.onPause` only after suppression; adding a refresh solely there leaves the secondary snapshot briefly ready after the primary has paused. Use an early readiness-only fan-out or equivalent ordering that does not alter face token ownership or shared alert behavior. UI-thread commit must refresh and enforce current readiness, even if a bridge read was stale.
5. The newly added `FaceVideoBox.begin` lifecycle condition uses `session.layer.eligible`. That excludes SDK25 and every secondary face. For DH43, gate protocol-2 session preparation and UI-thread commit on lifecycle readiness independently of surface-layer eligibility. Keep the above-window/operator-yield checks where they are appropriate; do not make SDK25 raise its surface. A missing readiness provider may retain legacy behavior, but configured DH43 hosts must not bypass the lifecycle gate.
6. Preserve each face's authenticated descriptor, token store, cache/session identity, decoder budget and output metrics. Continue using the shared emergency hold, where either face can protect both and one face cannot release the other's alert. Do not add side-B writes to primary watchdog/render-proof state.

Focused DH43 acceptance: with a visible Presentation that lacks input focus, both faces may become ready and independently prove advancing native frames. Pausing the Activity must revoke readiness for both before either decoder can restart. Returning while a native menu/recovery surface is present must wait. Closing it must yield one opportunity per host readiness epoch, with no above-window surface change on SDK25. Check both faces' content identities, frame/drop/stall evidence, and physical image; one healthy face cannot certify the other.

Private .35 scope now includes the two SDK33 panels plus the expressly authorized DH43 box/both faces. Stable fleet .29 remains unchanged. The lead owns implementation, CI/build checks, deployment and physical tests.


## Follow-up acceptance — corrected source reviewed

Result: **B1 and B2 are closed in the reviewed source. No remaining actionable blocker found in the exact corrections and DH43 lifecycle adaptation requested for this follow-up.** This is approval of the scoped source changes for the private hardware test, not a claim that .35 is physically qualified or that DH43 frame loss is solved.

- B1: `NativeDualVideo.canHandoff` now distinguishes a missing/unknown query result from a real not-ready or changed-epoch result. Unknown reads defer the same prepared controller with bounded rechecks; exhaustion invokes the existing unknown-failure policy rather than manufacturing `page-stopped`. Document invisibility defers at the same epoch. Only a real native readiness/epoch change enters the lifecycle wait. Post-handoff commit uses the same gate and its timer is canceled on fallback/unmount.
- B2: `classifyNativeVideoAvailability` has supported/legacy/unknown outcomes. Only a structurally valid old response with an absent availability property takes legacy behavior. Startup unknown/error remains on browser playback while discovery retries. Malformed advertised readiness cannot silently disable the new contract.
- The mounted React regression source directly exercises initial unknown discovery, same-epoch unknown handoff without a second prepare, resume occurring before the failed-state poll, blocked readiness/unmount, and retired loop-boundary callback cancellation. I read these tests but did not run them. The lead reports 27 web tests, preflight, and Android test/lint/build passing; those execution claims were not independently repeated here.
- Primary readiness is now supplied on all SDK versions. The SDK25/secondary adaptation does not change `SoloVideoLayer.eligible` or its above-window workaround. Protocol-2 begin/commit/watch gates are now independent of that layer eligibility.
- The secondary host explicitly supplies box foreground, host lifetime/attachment/visibility, its own recovery-overlay state, and the primary native UI predicate. `focusRequired=false` is explicit in the native snapshot and validated by the web contract, so a displayed secondary Presentation can be ready without input focus. The new native unit-test source covers that distinction.
- Activity pause now sets foreground false, refreshes the primary snapshot and calls secondary onPause/readiness refresh before global session retirement. Native commit refreshes readiness on the UI thread. The bridge publishes the immutable volatile snapshot and schedules UI observations rather than blocking a bridge worker on UI/monitor ownership.
- Existing operator latch behavior, emergency hold checks, per-face authenticated selection, decoder ownership, genuine native fault blocks, and protocol-1 compatibility remain intact in the inspected diff. Stable .29 behavior is selected only through valid legacy capability evidence; the intended .35 rollout remains private.

Physical acceptance remains the previously specified test on L55, M43, and both DH43 faces: verified native frame advancement, menu/pause/return without a fallback loop, preserved UI/emergency/blank/dim precedence, and correct surface/fit behavior on each hardware class. No additional code, build, test, or deployment action was performed by this reviewer.
