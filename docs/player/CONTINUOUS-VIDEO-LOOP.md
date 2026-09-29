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
about six seconds ahead and at least eight seconds behind, retaining the
preceding complete keyframe interval, and verifies each fragment before append.
Package revision 2 records sorted presentation keyframe ticks. Removal stops
one source tick before a retained keyframe at/before the history target, because
MSE can extend removal to the next random-access point. A fixed time cutoff
could remove the playing GOP when its keyframes were over eight seconds apart.
This keeps decoding dependencies while bounding history to eight seconds plus
one keyframe interval and the two-second cleanup batch. It refuses fragments over
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
The continuous guard is scoped by engine revision and source digest. Revision 2
gets one fresh attempt for a file blocked by revision 1; the older failure record
is preserved. A failure on revision 2 remains blocked across reloads for 24 hours.

`ContinuousBoundaryDetector` measures compositor frame hold at forward cycle
boundaries. Backend adoption starts a new timing session so native preparation
seams cannot be attributed to continuous playback. These are rVFC observations,
not camera measurements; maxSkipMs=0 describes the absence of deliberate trim,
not a claim that the hardware never drops a frame.

## Release and rollback

Continuous repetition is the standard for existing and newly paired screens.
The API requests it by default: unset/empty `PLAYER_LOOP_CONTINUOUS`, or `all`,
selects continuous for every screen identity. There is no enrollment record or
screen-by-screen activation step. The player still checks content/browser
eligibility and keeps the existing paths for emergency, sync, audio, mixed
playlists and unsupported formats. A failed continuous attempt restores native
playback and applies the existing per-file block.

Deploy API support before activating a new player: telemetry validates the
continuous backend strictly. The rollout override is optional:
`PLAYER_LOOP_CONTINUOUS=off` (also `0`, `false`, `no`) restores legacy selection
through `PLAYER_LOOP_TWODECK`; without a two-deck opt-in that is native playback.
A comma-separated screen-ID list restricts continuous for diagnosis or rollback.
Normal production uses `all` or leaves the variable unset. Continuous takes
precedence over legacy two-deck and is part of the manifest hash. A variable
change redeploys the API and clears its manifest cache; the next manifest poll
applies the selection. No APK or database migration is required.

## Qualification

Browser tests cover repeated playback with no seeks/source changes, bounded
buffering while offline, and corrupted-fragment fallback with persisted expiry.
Unit tests cover B-frame presentation coverage, exact stts durations, long-running
29.97 fps offsets, holes/overlaps, gating and compositor seam measurements. API
tests prove strict continuous telemetry acceptance. A synthetic 250-frame GOP
fixture covers retention of the playing frames over multiple cycles, matching
the 8.33-second keyframe interval observed in the Brookfield source. Existing native/two-deck and
emergency browser cases remain release checks.

Desktop browser success is not Android qualification. After an activation,
verify the current bundle SHA, backend=continuous, advancing boundary count, fresh
loop timestamp, hold/drop/stall counters and absence of fallback on the physical
older player. Confirm the visible seam on glass. Record restarts/offline recovery
and sustained behavior separately; do not fabricate hardware PASS rows.
