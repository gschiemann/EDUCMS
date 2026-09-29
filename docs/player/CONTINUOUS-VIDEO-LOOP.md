# Continuous video repetition

The native HTML video loop seeks to zero at the file boundary. Older Android
WebViews can pause while their decoder seeks and restarts. Two prepared video
elements did not advance concurrently on one tested Android 11 / WebView 95
panel. This backend uses one video element and one advancing MSE timeline.

## Implementation

`ContinuousLoopVideo.tsx` plays the verified original during preparation, then
adopts a single MediaSource URL. `continuousLoopPackage.ts` reads the original
from the ordinary playlist cache in 1 MiB chunks, uses pinned MP4Box 2.4.1 to
fragment it losslessly, and stores digest-checked fragments in a separate cache.
There is no origin fetch, re-encode, resolution change or whole-file ArrayBuffer.
Only the complete package manifest is published. One extra compressed file copy
is retained; abandoned packages are reclaimed on the next preparation.

`continuousLoop.ts` appends those fragments repeatedly at offsets calculated
from integer source ticks. It never seeks, changes src, reloads or calls
endOfStream at an ordinary boundary. The pump serializes append/remove, keeps
about six seconds ahead and eight seconds behind (plus a fragment and keyframe
retention), and verifies each fragment before append. It refuses fragments over
8 MiB, source files over 1 GiB, durations over ten minutes, timelines with gaps,
nonrandom-access openings, unsupported edits/codecs, and indexes not found in
three 1 MiB reads. The source time-to-sample table is authoritative for durations,
including B-frame encoder delay; MP4Box's mdhd-derived final duration is corrected.

The candidate is limited to normal solo, muted, unsynced MP4 playback with MSE,
rVFC and a verified source hash. Audio-enabled, emergency, synced and mixed
playlists use their existing paths. A failure restores the original on the same
element once, records a reason and blocks this file/backend for 24 hours. Page
cleanup cancels the pump, removes callbacks/listeners/timers and revokes its URL.
A blocked reload does not extend the block. Two-deck blocks are independent.

`ContinuousBoundaryDetector` measures compositor frame hold at forward cycle
boundaries. Backend adoption starts a new timing session so native preparation
seams cannot be attributed to continuous playback. These are rVFC observations,
not camera measurements; maxSkipMs=0 describes the absence of deliberate trim,
not a claim that the hardware never drops a frame.

## Release and rollback

Deploy the API support before activating the player: telemetry validates the
new continuous backend strictly. Set Railway `PLAYER_LOOP_CONTINUOUS` to one
explicit screen ID first. `all` is refused. The flag overrides two-deck only on
named screens and becomes part of the manifest hash. Leave working screens on
their existing backend. A variable change redeploys the API and clears its
manifest cache. Remove the canary ID to roll back; the next manifest poll restores
the prior backend. No APK or database migration is required.

## Qualification

Browser tests cover repeated playback with no seeks/source changes, bounded
buffering while offline, and corrupted-fragment fallback with persisted expiry.
Unit tests cover B-frame presentation coverage, exact stts durations, long-running
29.97 fps offsets, holes/overlaps, gating and compositor seam measurements. API
tests prove strict continuous telemetry acceptance. Existing native/two-deck and
emergency browser cases remain release checks.

Desktop browser success is not Android qualification. Before widening the canary,
verify the current bundle SHA, backend=continuous, advancing boundary count, fresh
loop timestamp, hold/drop/stall counters and absence of fallback on the physical
older player. Confirm the visible seam on glass. Record restarts/offline recovery
and sustained behavior separately; do not fabricate hardware PASS rows.
