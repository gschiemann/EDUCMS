# Astra candidate review — blockers preserved

Two concrete blockers found: (1) applyBlackout(true) MainActivity:1215–1235 adds a black View/bringToFront, but canOwnWindow predicate omits displayBlackoutView. Above-window video will cover native display blank indefinitely. Add explicit yield before blackout visibility and predicate guard against visible blackout. (2) new terminal reason operator-ui is absent from nativeSharedVideo.ts NATIVE_VIDEO_TRANSIENT_REASONS, so nativeVideoNext treats ordinary recovery/setup UI as codec/file failure and writes a 24h block. Use existing transient page-stopped or add operator-ui consistently + regression.

Third blocker: web overlays do not yield native. page.tsx:10904 updatePromptNode renders Software update ready/Updating controls at14237 alongside still-mounted NativeDualVideo; softBlank/softDim overlay also14244. Above-window surface covers them regardless DOMzIndex, and native canOwnWindow has no web-state signal. Small web eligibility/handoff suppression when showUpdatePrompt || softBlank || softDim>0 (plus existing emergency/stop) is required; do not rely on preDraw native-view guard to see DOM overlays. This reproduces the coveredUI defect even with correct first-frame timing.

These are pre-release review findings. Candidate is not committed, deployed or accepted; root is addressing them before field delivery.
