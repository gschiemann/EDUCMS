# Vision Core .37 soak: periodic native interruption

## Observed, not a continuous-native pass

Vision Core reported normal video after an operator-tested Wi-Fi outage and
reconnection. Native surface callbacks prove the Rockchip hardware decoder ran,
but uploaded recovery logs show repeated native teardown throughout the soak.
Use embedded event timestamps: uploads are buffered and their database timestamps
are often much later.

On October 14, native `activity-paused` stops occurred at 20:38:13, 20:53:13,
21:08:13 UTC, then on the same fifteen-minute cadence through October 15
03:53:13 UTC. The later sessions usually accumulated about 25,140 frames and
seven loops before teardown. Web fallback attempt numbers reached 29. A separate
`page-stopped` event occurred at 04:04:02 UTC and is not attributed to this timer.

At 13:26:27 UTC October 15, fresh telemetry again showed native presenting:
OMX.rk.video_decoder.avc, 1920x1080, 10,697 frames, three loops, zero reported
drops/stalls over 356,956 ms. That sample is not an all-day playback guarantee.
The aggregate report labels protocol 3; the session's low-level native markers
identify protocol 2, `above_window`. Do not infer a different renderer from the
aggregate protocol label.

## Concrete defect and correction

`WatchdogReceiver` runs every fifteen minutes. It checked standby and setup
yield, but otherwise always called `startActivity(MainActivity)`, including when
that singleTask Activity was already resumed. Android pauses a resumed Activity
to deliver a new intent. Our `onPause` correctly retires native sessions and
pauses the WebView; the web wrapper then falls back and later hands back to
native. This chain matches the observed cadence and explains a recurring source
of playback interruption. The precise large-play-icon pixels were not captured;
the operator's report remains part of physical acceptance.

The receiver now skips the Activity launch when `MainActivity.isInForeground`
is true. Heartbeat service maintenance, standby maintenance, native alert-watch
kick and the existing standby/setup checks still execute. Background/missing
Activity recovery is retained. No lifecycle retirement, emergency behavior,
native rendering, crop/stretch behavior or browser playback code is changed.
Foreground state remains separate from content-health proof.

[Android's onNewIntent contract](https://developer.android.com/reference/android/app/Activity#onNewIntent(android.content.Intent))
documents the pause/new-intent/resume sequence.

## Test scope and remaining acceptance

The regression check guards receiver ordering: maintenance runs before the
foreground return, and the return precedes launch. It failed against the original
receiver and passed with the fix. The full local suite completed with 908 passed,
two pre-existing web-source-location assumptions skipped, and no failures;
Android lint and `pnpm preflight` passed. This source test is not a physical
screen test. Signed candidate CI and physical testing remain separate gates.

On the corrected private APK, observe at least 45 uninterrupted minutes across
three watchdog intervals and many clip boundaries. Compare native session identity,
frame and loop counters before/after; no periodic activity-paused fallback, visible
pause, play icon, white screen or cropping is acceptable. Also test real remote
menu/pause/resume and existing hardware acceptance, including emergency coverage.
Do not mark .38 fleet-ready on the strength of .37's soak.

Brookfield snapshot at 13:21 UTC October 15: M43 and L55VEC were on .35 with fresh
native output and zero reported drops/stalls; G43 was on .35 with browser output;
DH43 primary was on .35 with browser output, and its back-face sample was stale
and showed roughly 56% dropped frames. Qualify DH43 with both faces active.
No device enrollment or fleet release changed during this investigation.
