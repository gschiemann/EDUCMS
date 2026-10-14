# Vision Core native handoff correction — 2026-10-14

Status: private candidate preparation; physical qualification pending. Do not
promote the stable fleet or re-enable native on an unattended panel from this report.

## Evidence and missed coverage

Vision Core's Venue-OS Media Player (`13eb0b62-d420-4517-922e-e17700716fae`)
reported installed `1.1.36-field.1`, SDK30, 1920×1080, at 05:13:57 UTC.
The operator reports white after native takeover on that build and says Claude
then excluded the device from native playback. Current rollout configuration
confirms that exclusion. Current runtime reports asleep/not foreground; the
last browser frame report is not proof of Android native playback.

The earlier above-window correction was limited to SDK33 primary solo video.
SDK30 therefore still attached a SurfaceView behind the WebView and depended on
Android/Chromium transparency after destroying the HTML decoder. A MediaCodec
render callback could immediately mark that path presenting, dismiss the web
hold frame, and satisfy both freshness watchdogs without establishing that the
window exposed the surface. This is a proven source ownership/evidence gap and
a plausible cause of persistent white, not a fresh reproduction of the exact
OEM compositor failure. The `.36` aligned codec selection does not change it.

## Correction

Full-face protocol2 primary video now uses delayed above-window ownership on
SDK30+, supported by Android R with this app's targetSdk34. Preparation and
browser boundary waiting remain below the window. Source, dimensions, fit,
rotation, exact manifest identity and SHA verification are unchanged.

The internal layer state is UNDER_WINDOW → QUEUED → REVEALING → ABOVE_WINDOW,
with terminal RETIRED. After the UI-thread z-order request, a valid render
timestamp must be strictly newer than the recorded request time before public
state becomes presenting. Current session, attachment, emergency, foreground
and operator ownership are checked again. Delayed pre-request callbacks cannot
complete takeover or resurrect a retired session.

REVEALING has an independent 3.5-second deadline; native retires an unacknowledged
surface even if nonqualifying decoder callbacks continue. Retirement invalidates
first and synchronously hides/removes the surface on the UI thread. Emergency,
Back/menu, blank/dim and Activity pause retain their existing yield paths.
Pre-R, secondary-face and positioned protocol3 composition remain separate
hardware qualification lanes; this correction does not qualify DH43.

## Diagnostics and proof limits

Native markers record reveal request, post-request render and stop reason with
SDK, face, hash prefix, codec, size and callback context. Three asynchronous
32×18 PixelCopy samples of the SurfaceView buffer run at first acknowledgement,
+10 seconds and +60 seconds. They record only copy result and aggregate bright/
dark counts, export no image, and never decide playback or fallback. Retired or
replaced sessions cannot report them. Every completion/failure recycles the
bitmap. Coalesced log uploads use the existing authenticated diagnostics route,
this face's native credential and approved API root, at most once per face/minute.

These are **surface-buffer samples**, not final-screen captures. Logged PTS/frame
values are callback-time context, not the precise copied-buffer timestamp. A
scaled sample does not establish full-resolution uniformity. Nonwhite buffer
data alongside independently observed white glass supports investigation of
composition/other windows; white buffer data points toward actual decoder output
at the sample time. Neither alone proves the historical cause.

Android R applies dynamic z-order using an asynchronous RenderThread/SurfaceControl
transaction. A post-request decoder frame is better ordering evidence, not a
transaction-complete or physical-visibility acknowledgement. Normal web telemetry
currently discards native `layerMode`; use the bounded native markers, not a
top-level browser `engine:"native"` label, to inspect this transition.

## Required physical acceptance

Keep native excluded until an attended, screen-scoped test can record the exact
installed APK/hash, matching web bundle, source and descriptor. Observe the
browser → hold → native transition and at least five complete loops; correlate
the picture with post-request layer markers and fresh native PTS/frame deltas.
Check Back/menu, repeated pause/resume, blank/wake, surface loss/fallback and
authorized emergency trigger/all-clear. An alert must cover the native output
immediately; remote escape must remain reachable. No white, unexpected bars,
crop, source-quality change or repeated web/native oscillation is acceptable.

If elevated output still shows white, inspect the buffer samples and composed
window/layer evidence instead of making another unobserved z-order patch.
Rollback is the exact screen's optional native enrollment with an immutable
AuditLog; stable fleet release remains `1.1.29`.

## References

- [SurfaceView API](https://developer.android.com/reference/android/view/SurfaceView)
- [Android11 SurfaceView implementation](https://android.googlesource.com/platform/frameworks/base/+/android-11.0.0_r1/core/java/android/view/SurfaceView.java)
- [MediaCodec frame callback semantics](https://developer.android.com/reference/android/media/MediaCodec.OnFrameRenderedListener)
- [PixelCopy API](https://developer.android.com/reference/android/view/PixelCopy)

Validation results and signed artifact provenance are retained with the lead's
Desktop `template-flagship-audit/native-white-core-2026-10-14` checkpoint. Unit,
lint and build success are software claims; no hardware PASS is asserted here.
