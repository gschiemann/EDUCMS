# Frame-ready video playlist handoff

Ordinary video playlists previously advanced by removing the outgoing video
before the incoming element had decoded a frame. Fade and slide effects could
expose the paused video poster or native play icon. A single-file loop already
had a retained playback path; this change extends retained surfaces to eligible
multi-file playlists.

## Runtime implementation

`apps/web/src/app/player/page.tsx` mounts `PlaylistVideoDeck` for an all-video,
free-running playlist with more than one distinct playable file. Existing cache
readiness, daypart eligibility, synchronization, crash protection, and two-decoder
circuit-breaker checks still apply. Emergency and synchronized playback use the
previous rendering path. A mixed image/video playlist uses the previous path,
with ordinary free-running video effects disabled.

`PlaylistVideoDeck.tsx` owns exactly two persistent video elements. It attaches
the existing quality tracker to the presented surface, runs the existing media
stall detector, and records the existing loop guard. It does not copy full frames
to a canvas, change the video bytes, resize uploaded media, or introduce another
decoder. Player styles use physical sides and explicit sizes for old Taurus
Chromium compatibility.

`playlistVideoHandoff.ts` implements the following sequence:

1. Load the next playable source into the hidden, muted standby element.
2. Near the outgoing video's end, briefly play the standby to decode its opening
   frame, then pause it. The initial lead is 450 ms, adjusted within 300–1200 ms
   from measured frame readiness.
3. When the playlist advances, resume the prepared element without a second seek
   to zero. Keep the outgoing surface visible until the incoming surface produces
   a decoded frame. Use `requestVideoFrameCallback` where available; older engines
   require decoded-frame or playback-time progress with loaded video data.
4. Swap the opaque surfaces, restore requested audio, pause/mute the outgoing
   element, and reuse it for the following source. There is no opacity animation.

Generation tokens discard late frame callbacks and play rejections after a source
change. Destruction cancels callbacks/timers/listeners and releases both sources.
A missing incoming frame times out after eight seconds and uses the existing
failed-file/advance path. Standby failure, playback rejection, or a three-second
preroll timeout releases the second decoder and selects single-decoder playback
for that session; the existing persisted guard blocks repeated unsafe attempts.

If a browser refuses audible autoplay, the presented video resumes muted rather
than staying paused. A user gesture can retry audio. Unrelated parent renders do
not repeatedly unmute a browser that denied audio. Android kiosk audio continues
to use its existing autoplay permission.

## Operator behavior

Normal video rows retain their audio setting and display a direct-switching
explanation instead of unsupported fade/slide choices. Previously stored effects
are treated as None during normal free-running video playback. Image transition
choices remain available. Protected/emergency editor controls and synchronized
player behavior retain their prior paths.

The accompanying UI changes remove group-header counts, combine delivery and
resync information into the screen's Content card without an endless confirmation
spinner, and order getting started as Connect a screen, Upload an asset, Create
a playlist. A starter template is an optional card after those basic steps.

## Verification and limits

Engine tests cover decoded-frame gating, parked standby reuse, hidden audio,
three-file wraparound, once-only advancement, late callbacks/rejections, startup
timeout, decoder failure, audio-autoplay denial, and legacy frame polling.
Chromium and WebKit tests use real red/green/blue MP4 bytes through multiple laps,
verify two persistent surfaces and an opaque decoded picture at each sampled
handoff, and exercise a failing standby. Operator browser tests verify video
settings, onboarding, inherited locations, update controls, and consolidated
Content status. The ZIP regression downloads one archive and checks all three
file entries and bytes in both browsers.

These tests establish browser behavior, not physical qualification on every old
Android or 4K decoder. Mixed-media handoffs and seamless audio are not promised by
this implementation. Existing single-video continuous looping remains unchanged.
The change ships in the hosted web player; it does not rebuild or replace the
published Android 1.1.20 APK. Existing players receive it through the normal
hosted-bundle update mechanism.

The same release raises patched dependency floors for Next.js, multer,
ip-address, fast-uri, and DOMPurify without suppressing advisories or weakening
CI gates. The production dependency audit is clean locally; final deployment and
CI evidence are recorded in the task checklist.
