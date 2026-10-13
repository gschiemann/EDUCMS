# Native candidate review — actionable blockers

2026-10-13. Read-only review of uncommitted candidate in `/Users/gschiemann/.codex/worktrees/android-field-recovery/EDU CMS`, base `44a608e8`. Read FaceVideoBox, SharedVideoHost, MainActivity, SoloVideoLayer and its test, and the existing web consumer/overlay paths. No source edits, builds, or device actions. This is a source review, not approval of physical composition.

## [P1] Above-window output defeats the native blackout

`MainActivity.kt:2487–2491` permits native window ownership when cards/recovery/site overlays are absent, but does not check `displayBlackoutView`. `applyBlackout(true)` at `1215–1235` adds a black View and calls `bringToFront()`. An above-window SurfaceView is above that View regardless of view-tree ordering. Consequently Blank can report success while solo video remains visibly playing; first-frame promotion can also happen while a blackout is already visible.

Fix: yield the host before showing a native blackout and include visible `displayBlackoutView` in `canOwnWindow`'s predicate, so both takeover and ongoing playback are blocked. Preserve emergency override behavior; never acquire/release emergency hold in this change. Test blackout before first render and after native takeover, then Wake.

## [P1] Web update and soft-blank overlays remain behind promoted output

`page.tsx:10904` renders the actionable Software update ready / Updating overlay; its buttons include Not now and update controls. The media branch mounts it at `14237` alongside the playing content. `softBlankOverlay` mounts at `14244`, uses a black CSS overlay with opacity `softBlank ? 1 : softDim` (`11401`). Native eligibility at `12572–12607` does not yield for these states. The new pre-draw guard only sees native View visibility, not web overlay state. Therefore promoted video covers the update controls and web blank/dim fallback. This is the same covered-UI failure that the promotion lifecycle is meant to prevent.

Fix: withdraw the native descriptor/eligibility while `showUpdatePrompt`, `softBlank`, or `softDim > 0` requires web composition, allowing existing controller cleanup to stop native. Keep this narrowly tied to overlay ownership rather than changing playback or fit. Verify update prompt and software Blank/Dim after takeover and during queued promotion; ensure web stop/remote Escape still unmounts the native owner and shows usable controls. If other mandatory web overlays are allowed over solo playback, they need the same ownership condition; CSS z-index cannot solve it.

## [P2] Ordinary UI yielding becomes a 24-hour native file block

New calls throughout `FaceVideoBox` and `SharedVideoHost` retire with reason `operator-ui`. Existing `nativeSharedVideo.ts:322–337` does not include it in `NATIVE_VIDEO_TRANSIENT_REASONS`; `NativeDualVideo.tsx:27–42,200–208` therefore classifies it as a native file fault and persists a 24-hour block. The native mirrored reason set (`FaceVideoPolicy.kt:140–141`) also lacks it. A recovery or native setup overlay that leaves the NativeDualVideo component mounted can thus disable native for a healthy file for the rest of the day. Explicit Back can race component cleanup/polling and has the same classification risk.

Fix: use the existing semantically suitable `page-stopped` transient reason, or add `operator-ui` to both bounded transient sets and test its classification. Preserve the existing rule that an attempt which already handed off stays web after a transient end rather than oscillating immediately back to native.

## Review conclusion

These three issues should be resolved before private installation. The queued first-render promotion otherwise guards liveness, holder attachment, emergency and UI ownership; retirement invalidates the layer before removing views; main-thread removal is immediate; stale callbacks cannot successfully promote a retired layer. No additional actionable monitor-order or cross-face cleanup blocker was found in this bounded review. The pure SoloVideoLayer tests establish state-machine behavior only and do not exercise these native/web overlay integrations or Android composition. Physical acceptance on both Brookfield units remains required.
