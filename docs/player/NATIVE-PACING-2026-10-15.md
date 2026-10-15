# Native pacing correction after .38 field testing

## Measured problem

All four Brookfield models and both DH43 faces installed .38 and supplied fresh
Android native decoder/surface evidence. At 18:20 UTC, G43's current session
reported 43,785 frame callbacks and 42,984 deliberate application drops. Its
alternating-drop policy therefore discarded nearly half of decoded outputs.
M43 and L55VEC reported very few deliberate drops while the operator still saw
stutter. A callback count or a zero-drop counter is not a cadence guarantee;
Android before API34 can omit frame-rendered callbacks.

The decoder queued only one compressed packet, waited for one output, and held
that output until approximately 2ms before its presentation deadline. This
blocked further input feeding and left almost no SurfaceView scheduling margin.
Input unavailability could delay release of the output needed to free input.
The never-consecutive-drops rule could keep showing stale frames indefinitely.

## Correction

- Bounded nonblocking input feeding and output draining on the same codec thread.
- One pending early output; feeding continues while it waits for its target.
- Future-timestamp surface release with about two display refresh periods of
  lead, capped at 50ms. Preserve the media clock and original presentation times.
- Consecutive stale-output drops with a 250ms maximum intentional render gap.
  This is catch-up behavior, not a claim that slow hardware can decode faster.
- Play-once completion waits until the last scheduled picture's frame period
  ends. Empty EOS must not retire a future-scheduled final picture early.
- Optional bounded scheduling diagnostics distinguish decoded/submitted frames,
  lateness and submission gaps from actual frame-render callbacks. They also
  report coded source dimensions. These diagnostics cannot stamp render proof.

Codec selection, source resolution, fit/crop, seamless loop timestamp mapping,
surface ownership, lifecycle and emergency retirement remain unchanged. No
clock rebasing, silent source downgrade or watchdog rollback is introduced.

## Quality history

L55VEC and M43 had existing audited 1080p quality demotions from October12/13.
The operator cleared these on October15 at 17:41:41 and 17:42:30 UTC. Their
subsequent native sessions and G43 use the primary 4K file. Registration can
independently overwrite a stored resolution, but it is not established as the
cause of these demotions; no registration policy change is included here.

## Validation and remaining qualification

Local Android unit tests and lint passed, including fake-codec backpressure,
multi-packet priming, bounded read-ahead, a 300ms scheduling hitch followed by
real-time recovery, consecutive stale drops, a persistently slow decoder and
future-frame EOS. Web parsing and API validation tests preserve the separation
between diagnostic counts and rendering evidence. Astra's static review found
an early-EOS issue; it was corrected and re-reviewed without remaining blockers.

Before fleet release, observe the unchanged beach file on G43, M43, L55VEC and
both DH43 faces together. Compare fresh same-session sourcePTS/wall-time deltas,
submitted/drop deltas, lateness and gaps; verify visible smoothness at loop
seams against the known-good browser reference. Repeat remote menu/pause/resume,
offline continuation, wake and required emergency coverage. Unit tests and
static review cannot qualify the OEM display/compositor. .38's long native
sessions do not qualify this new scheduling implementation.

References: [MediaCodec scheduled surface output](https://developer.android.com/reference/android/media/MediaCodec#releaseOutputBuffer(int,%20long)),
[frame-render callback limits](https://developer.android.com/reference/android/media/MediaCodec.OnFrameRenderedListener),
[Media3 frame release helper](https://github.com/androidx/media/blob/release/libraries/exoplayer/src/main/java/androidx/media3/exoplayer/video/VideoFrameReleaseHelper.java).
