# APK Testing — How to Verify Chromium 95 + Older Devices

## TL;DR

**No new APK has been built or shipped this sprint.** The Android compatibility
work that landed in commit `3efd74f` lives ENTIRELY in the web bundle —
your existing APK loads `https://venue-os.app/player` on boot
and the new capability detection code is part of that bundle. **No APK
rebuild needed for any of the new features (streaming, POS, ads,
billing UI, capability runtime).**

What you DO need:
1. Push web changes (already done — master is at the latest)
2. Wait for Vercel to redeploy (~2 min)
3. Existing APKs on your test devices automatically pick up the new
   bundle on next refresh / pairing handshake

## What the existing APK does

The APK is a thin Android wrapper around a system WebView. On boot:

1. Reads its paired tenant + screen URL from local storage
2. Loads `https://<vercel-prod>/player?...&w=...&h=...` in the WebView
3. The WebView fetches whatever Next.js bundle is currently deployed
4. That bundle's Service Worker takes over caching from then on

So when we deploy a new Next.js bundle to Vercel:
- The next page reload picks it up
- Service Worker caches the new assets
- Capability detection runs at boot, logs to console, reports to server

**The APK itself only needs to change when:**
- We add a new Android-side native bridge (e.g. new `Native.requestPip()` call)
- We change the splash screen, app icon, or package signature
- We update the system WebView dependency (rare)
- A security hotfix affects the wrapper

None of those apply to the current sprint. The APK on your test devices
is fine as-is.

## Testing Chromium 95 (and older) without re-building the APK

You have three paths:

### 1. Browser-based: Chrome DevTools "Disable JavaScript" + UA override

Quick smoke test — set the User-Agent to mimic an older Android WebView,
then open the player URL in your desktop Chrome. Capabilities still
report based on YOUR Chrome's actual feature support (since the UA only
changes the string, not the engine). Useful for seeing how the player
LAYS OUT on a 1920x1080 screen but doesn't actually test old-engine
compatibility.

### 2. BrowserStack / Sauce Labs — real older Android devices

Sign up for a free trial at https://www.browserstack.com/live and pick
"Android 7" or "Android 8" — they spin up a real device with stock
Chromium. Open `https://venue-os.app/player` and inspect the
console: you'll see the `[Player] capabilities` log line with the real
detected feature flags.

For the player to fully boot you'd need to pair the device first via
the in-app flow — easier just to load the public `/preview/<templateId>`
route to verify rendering.

### 3. Real hardware — your test kiosks

Actual answer for production confidence. Connect ADB to a kiosk:

```bash
adb shell am start -n com.venueos.player/.MainActivity \
  -d "https://venue-os.app/player?devmode=1"
adb logcat | grep '\[Player\]'
```

The logcat output will show the capability snapshot on boot:

```
I/Console: [Player] capabilities { chromium: 78, modern: false,
            containerQueries: false, backdropFilter: true,
            h265: false, av1: false }
```

That tells you what Chromium version the device's WebView is on and
which fallback paths the renderer will pick.

## What capability falls back to what

On Chromium <105 (no container queries), widgets that use them fall
back to width-based grid layouts. On Chromium <76 (no backdrop-filter),
glass cards render as solid translucent panels. On devices without
H.265 decode, video assets transcoded to H.264 are picked instead via
`pickBestVideo()`. On Chromium <51 (very old, edge case), polyfills
load lazily for IntersectionObserver / ResizeObserver via
`ensurePolyfill()`.

Full feature matrix in `docs/ANDROID_COMPATIBILITY.md`.

## Capability widget audit

Tracking which widgets actually USE the capability layer (vs. just the
detection layer being available):

| Widget | Uses capabilities? | Notes |
|---|---|---|
| StreamingWidget | Partial — hls.js polyfill loads on non-Safari | Could pick best codec via pickBestVideo() once transcode pipeline ships |
| Glass/Backdrop themes | No (uses CSS @supports — auto-fallback) | Pure CSS path, zero JS |
| Container-query layouts | Partial — most use @supports | A few legacy widgets need an audit pass |
| Video widget (asset playback) | No | Should pick H.264 over H.265 on old devices once transcode pipeline ships |
| All other widgets | No (don't need it) | Capability layer is only needed where features go beyond the universal baseline |

The sample-data harness loads test HLS streams (Mux test bucket) which
are H.264 — they play on Chromium 60+. Public broadcasters use YouTube
embeds, which YouTube's iframe handles for us regardless of the device's
codec support.

## Building a fresh APK (if you ever need to)

If you DO need to rebuild — e.g. updating the splash screen or signature
— the GitHub Actions workflow `.github/workflows/build-apk.yml` builds
universal APKs on every push to `master`. Download from the Actions tab
once the workflow completes.

For a one-off debug build:

```bash
cd android-player
./gradlew assembleUniversalDebug
# → app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

Universal = bundles arm64-v8a, armeabi-v7a, x86, x86_64 ABIs in one
file, so it installs on any Android 7+ device including old x86 tablets.

## What's pending for the next APK

These would be APK-side changes (wrapper-level, not just Next.js bundle):

- [ ] System WebView version probe at boot — the APK can refuse to
      run on Chromium <60 with a friendly upgrade prompt
- [ ] Native PiP support for the streaming widget
- [ ] Hardware codec detection passed to the web layer (some Android
      devices can decode H.265 in hardware but report it as unsupported
      in `canPlayType` — APK can probe MediaCodec directly and inject
      a capability hint)
- [ ] Battery / power-save hints (kiosks plugged into smart power
      strips — APK can throttle the manifest poll cadence on battery)

None blocking for launch.
