# EduCMS Android Player

Native Android APK for K-12 digital signage. Targets **Android 7.0 (API 24) → Android 14 (API 34)** and runs on phones, tablets, set-top boxes, and dedicated kiosk hardware (Amazon Fire, Lenovo ThinkSmart, Mecool / RK35xx boards, etc.).

## Architecture

A thin **WebView shell** that hosts the existing web player (`apps/web/.../player`). The web app continues to do all rendering — zones, widgets, playlists, themes, emergency overrides — and the APK provides the things a browser can't:

- Fullscreen immersive (no nav bar, no status bar, no swipe-to-escape on Android 11+)
- Wake lock + screen-on (24/7 display never sleeps)
- Auto-start on device boot (`BootReceiver`)
- Pairing flow (operator types a code on the screen → exchanges for a long-lived token)
- WebView crash recovery (`onRenderProcessGone` → reload)
- JS ↔ native bridge (`window.EduCmsNative.unpair()`, `.reload()`, `.deviceInfo()`)
- Same-origin navigation lockdown (no escape via `mailto:`, `intent://`, etc.)
- Custom user-agent (`EduCmsPlayer/1.0.0`) so the web app can detect kiosk mode

The existing web player is **kept as the source of truth**. Browser-based testing keeps working; the APK is just a deployment surface.

## Project layout

```
apps/player/
├── build.gradle.kts            ← root
├── settings.gradle.kts
├── gradle.properties
├── gradle/wrapper/
└── app/
    ├── build.gradle.kts        ← minSdk 24, targetSdk 34
    ├── proguard-rules.pro
    └── src/main/
        ├── AndroidManifest.xml
        ├── java/com/educms/player/
        │   ├── PlayerApp.kt
        │   ├── MainActivity.kt          ← WebView shell + kiosk
        │   ├── PairingActivity.kt       ← enter pairing code
        │   ├── BootReceiver.kt          ← autostart on boot
        │   ├── DeviceStore.kt           ← DataStore-backed token storage
        │   ├── WebAppBridge.kt          ← JS interface
        │   └── SafePlayerWebViewClient.kt
        └── res/                          ← layouts, strings, theme, icons
```

## Build

You need **Android Studio Hedgehog (2023.1)** or newer, JDK 17, and Android SDK 34 installed.

```bash
# from repo root
cd apps/player

# First-time only — generate the gradle wrapper jar/scripts.
# (Open in Android Studio and let it sync, OR run a system Gradle once:)
gradle wrapper --gradle-version 8.7

# Debug APK (installs as com.educms.player.debug)
./gradlew assembleDebug
# →  app/build/outputs/apk/debug/app-debug.apk

# Release APK (unsigned — sign before sideloading to kiosks)
./gradlew assembleRelease
# →  app/build/outputs/apk/release/app-release-unsigned.apk

# Point the player at a different web deployment at build time:
./gradlew assembleRelease -PplayerBaseUrl="https://yourtenant.educms.app/player"
```

## Pairing flow

1. Admin opens **Dashboard → Screens → Add Screen** in the web app.
2. Web app generates a 6-character code (e.g. `K9X4Q2`) tied to the tenant.
3. Operator launches the player on the Android device, types the code, taps **Pair**.
4. APK posts to `POST /api/v1/devices/pair` with `{ code, deviceFingerprint, model, os }`.
5. Server returns `{ token, screenId, tenantSlug }`. Token persisted in encrypted DataStore.
6. Player loads `${PLAYER_BASE_URL}?token=…&client=android&v=1.0.0` and stays there forever.
7. To re-pair: from the web dashboard call `EduCmsNative.unpair()` (or factory-reset via long-press / dashboard "Unpair device" action).

## Required server endpoint

The pairing flow expects this endpoint to exist on the API:

```
POST /api/v1/devices/pair
Content-Type: application/json
Body:    { "code": "K9X4Q2", "deviceFingerprint": "...", "model": "...", "os": "Android 14", "appVersion": "1.0.0" }
200:     { "token": "<jwt>", "screenId": "<uuid>", "tenantSlug": "<slug>" }
4xx:     { "message": "Code expired" }
```

If this endpoint isn't implemented yet, the player will fail with an HTTP error on pair. The simplest stub: reuse the existing `/api/v1/devices/register` flow with a code lookup against the `Screen.pairingCode` column.

## Deployment to kiosk hardware

### Sideload via ADB (testing)
```bash
adb install -r app/build/outputs/apk/release/app-release.apk
adb shell am start -n com.educms.player/.PairingActivity
```

### MDM / EMM (production)
Recommended: **Headwind MDM**, **Hexnode** (paid), or **Android Enterprise Dedicated Devices** (free if you self-host the EMM). Push the APK silently to all enrolled devices; lock down to `com.educms.player` as the only allowed launcher (`setLockTaskPackages`).

### Manual kiosk lockdown (single-device install)
1. Set the player as the default launcher: `Settings → Apps → Default apps → Home app → EduCMS Player`
2. Disable Notification Shade swipe (most OEMs have this in `Settings → Display → Kiosk mode`)
3. Disable status bar pull-down: requires device-owner; use `dpm set-device-owner com.educms.player/.PlayerDeviceAdmin` (admin receiver not yet implemented — V2)

## USB sneakernet ingestion (Sprint 7B)

Run the EduCMS player with **zero internet** by sideloading content over USB. End-to-end flow:

### 1. Admin enables USB ingest for the tenant (one-time)

```
PUT  /api/v1/tenants/me/usb-ingest         { "enabled": true }
POST /api/v1/tenants/me/usb-ingest/rotate-key
```

The rotate response contains the HMAC key — **shown once, never again**. Save it as `EDU_USB_KEY` env var or paste into a `.key` file kept off public storage.

### 2. Operator builds a USB bundle

```bash
export EDU_USB_KEY=<64-char hex from step 1>

pnpm tsx scripts/usb-bundler.ts \
  --tenant <tenantId> \
  --key $EDU_USB_KEY \
  --out /media/USBSTICK \
  --asset https://cdn.example/welcome.mp4 \
  --emergency-asset https://cdn.example/lockdown-2026.mp4 \
  --emergency-asset https://cdn.example/evacuation-map.jpg
```

The bundler downloads each asset, computes SHA-256, lays out:
```
/media/USBSTICK/edu-cms-content/
  manifest.json        (signed)
  manifest.sig         (HMAC-SHA256 hex)
  assets/<sha256>.<ext>
  emergency/<sha256>.<ext>
```

### 3. Operator walks the stick to the screen

Plug into the Android player. The OS fires `USB_DEVICE_ATTACHED` → `UsbAttachReceiver` → `UsbIngestActivity`:

1. System file picker prompts the operator to select the USB root
2. `UsbIngester` verifies the HMAC signature against the locally-stored tenant key
3. Verifies every asset's SHA-256 hash
4. Copies accepted assets into `filesDir/usb-cache/`
5. Toast confirms; bounces back to the player
6. Player picks them up on next manifest sync (the WebView's Service Worker reads the new local cache)

Rejected outcomes:
- `REJECTED_SIGNATURE` — wrong tenant key or tampered manifest
- `REJECTED_HASH` — file content doesn't match its declared hash (tampered or corrupt)
- `REJECTED` — wrong tenantId, missing files, bad layout
- `CANCELLED_BY_OPERATOR` — operator dismissed the picker

Every outcome posts a `UsbIngestEvent` audit row to the server (visible at `GET /api/v1/tenants/me/usb-ingest/events`).

### V1 status (2026-04-17)

- ✅ Schema + migration (`Tenant.usbIngestEnabled/Key`, `UsbIngestEvent` table)
- ✅ Server endpoints (rotate, get config, list events, accept event POST)
- ✅ Bundler CLI (`scripts/usb-bundler.ts`)
- ✅ Android receiver + ingest activity + signature/hash verification
- ⏳ `/devices/pair` endpoint must be extended to also return `{ usbIngestKey, tenantId }` so the player has the key without a separate fetch
- ⏳ Admin PIN prompt on first ingest from a new device serial
- ⏳ Escalated approval for emergency-tier asset updates
- ⏳ Service Worker reads `filesDir/usb-cache/` (currently in `/usb-cache/` on disk; SW fetch handler needs a hook)

V1 is wired end-to-end except for the pairing-endpoint key handoff and SW pickup — both are 1-day follow-ups.

## Roadmap

V1 (this scaffold):
- [x] WebView shell with kiosk immersive + wake lock
- [x] Pairing flow + persistent token
- [x] Boot autostart
- [x] Renderer crash recovery
- [x] Same-origin navigation lockdown
- [x] Adaptive icon + Material 3 theme

V2 (next):
- [x] Local asset cache (Service Worker + Cache API, two tiers — playlist + never-evict emergency) — `apps/web/public/sw-player.js`
- [ ] Foreground service heartbeat (notify server every 60s) — see **Render-proof heartbeat & native watchdog** below; the web-side render-proof shipped 2026-05-29, the native foreground-service watchdog is the remaining piece
- [ ] OTA APK self-update via APK Expansion or in-app installer
- [ ] Device-owner provisioning helper for true kiosk lockdown
- [ ] ExoPlayer for video-heavy zones (bypass WebView for HEVC/HDR)
- [ ] Local emergency cache (last 4 emergency payloads play even if offline)
- [x] Crash reporting → Sentry (free tier shared with web) — **web/renderer side wired 2026-05-29**: `PlayerErrorBoundary.componentDidCatch` in `apps/web/src/app/player/page.tsx` calls `Sentry.captureException` (tagged `surface=player`, with the React component stack). No-op unless `NEXT_PUBLIC_SENTRY_DSN` is set. A *native* (Kotlin) Sentry SDK for crashes that kill the WebView host process itself is still a follow-up — see below.

## Render-proof heartbeat & native watchdog (the "frozen kiosk shows green" fix)

> **Status (2026-05-29):** the **render-proof heartbeat** (web side) and
> **Sentry renderer-crash reporting** (web side) shipped. The **native
> Android foreground-service watchdog** below is the remaining, documented
> follow-up — it is **not yet built**.

**The gap this closes.** A kiosk can freeze while still answering TCP reads:
the Android shell is alive, the network stack responds, so the server's
`lastPingAt` (and the `/cache-status` POST, which fires on a plain
`setInterval`) stay fresh — and the fleet map shows the screen **ONLINE /
green** while it is actually displaying a stuck or black frame. That is the
single worst live-game / live-emergency failure: *looks online, shows
nothing.* `lastPingAt` proves "TCP-reachable + JS event loop alive"; it does
**not** prove "pixels painting."

### What shipped (web side) — 2026-05-29

1. **Render-proof signal in the player.** A `requestAnimationFrame` loop in
   `apps/web/src/app/player/page.tsx` advances a paint counter. rAF callbacks
   are scheduled by the compositor, so the counter **only advances when a
   frame is actually painted** — a frozen renderer, backgrounded tab, or
   wedged compositor stops it. The player POSTs the counter + a content
   signature to **`POST /api/v1/screens/:id/render-proof`** every ~30s, but
   **only while rendering operator content** (playing a playlist/template or
   showing an emergency), and **skips the POST if the counter hasn't advanced**
   since the last report — so a frozen renderer lets `lastRenderedAt` go stale
   instead of papering over the freeze.
2. **Three additive `Screen` columns** (`last_rendered_at`,
   `last_rendered_frames`, `last_rendered_hash` — migration
   `20260529000000_add_screen_render_proof`). All nullable; nothing about
   `lastPingAt` / `status` / emergency / manifest behavior changed.
3. **Fleet-status RED.** `GET /api/v1/screens` now derives a **separate**
   `renderHealth` field (`OK` / `STALE` / `UNKNOWN`) via
   `apps/api/src/screens/render-proof.ts` `deriveRenderHealth()`: a screen
   that is `status: ONLINE` (fresh ping) but whose `lastRenderedAt` is stale
   reads `renderHealth: STALE` (degraded/RED). `status` itself is **not**
   reinterpreted — a frozen screen is reachable, not offline — so the existing
   dashboard map (which keys OFFLINE off `status !== 'ONLINE'`) is unchanged;
   UIs that want the true frozen signal read `renderHealth`. A `null`
   `lastRenderedAt` (older player build / freshly-paired / offline) reads
   `UNKNOWN`, never RED, so old builds are never falsely alarmed.
4. **Sentry renderer-crash reporting** — see the Roadmap item above.

### Follow-up — native Android foreground-service watchdog (NOT yet built)

The render-proof above recovers the case where the JS event loop is alive but
not painting (it makes the freeze *visible* to the operator, and the existing
`ScreenWedgeDetectorCron` fires `REFRESH_WEB`). It does **not** cover the case
where the **WebView host process itself is gone / ANR'd** — there is nothing
inside the dead WebView left to POST anything. That needs a watchdog living
**above** the WebView, in native Android. Spec for the next agent:

- **A `Service` running in the foreground** (`startForeground` with a
  low-priority "VenueOS player running" notification — required on Android 8+
  so the OS doesn't kill it). Foreground services survive Activity teardown
  and memory pressure far better than a plain Activity timer.
- **Liveness ping from the WebView → the service.** The web player already
  calls `EduCmsNative.heartbeat()` every 60s (updates
  `MainActivity.lastSuccessfulLoadAtMs`). Extend the bridge so the **render-
  proof paint counter** (not just "JS ran") is what the service watches —
  i.e. surface `renderFramesRef` over the bridge and have the service treat
  "frames not advancing for N seconds" as wedged, not just "no heartbeat
  method call." This is the key upgrade: today the native watchdog reads a
  signal that proves the event loop ran, not that pixels painted.
- **Escalating recovery ladder:** (1) `WebView.reload()` →
  (2) recreate the `Activity` / WebView → (3) if still wedged after K
  attempts, `Process.killProcess(myPid())` and let the boot/keep-alive
  receiver relaunch the whole app. Bound the cadence (exponential backoff)
  so a hard-crashing build can't hot-loop the CPU — mirror the web
  `PlayerErrorBoundary`'s 3-fast-then-slow strategy.
- **Native Sentry SDK** (`io.sentry:sentry-android`, gated on a DSN
  BuildConfig field) so a crash that takes down the **host process** —
  invisible to the web-side `Sentry.captureException` — is still reported.
- **Report each forced recovery** to the existing
  `POST /api/v1/screens/status/:fp/crash-report` (source `player`) so the
  dashboard shows "native watchdog force-restarted this kiosk N times" —
  the operator's cue to push an APK update or physically intervene (the same
  escalation `ScreenWedgeDetectorCron` already audits with
  `AUTO_RECOVERY_GAVE_UP`).
- **Keep it below the 2-min `lastPingAt` OFFLINE threshold** so a watchdog
  restart that takes a few seconds is invisible on the fleet map.

This is the R2/R3 "native watchdog ABOVE the WebView" item from
`docs/research/2026-05-29-sports-provenue-gap/05-reliability-multisurface-hardware.md`
(Tier-1 reliability hardening). It pairs with — does not replace — the
web-side render-proof: render-proof makes a freeze *observable* fleet-wide;
the native watchdog makes a freeze *self-recovering* even when the WebView
process is dead.

## Notes

- **Why WebView instead of native Compose?** The web player already implements 17 themed templates, 20+ widget types, 120+ variants, drag-and-drop builder, and SSE realtime — porting all of that to Compose would take 6 months. The shell approach gets us to a sellable APK in days, and lets the web team ship updates without rebuilding the APK.
- **Why minSdk 24?** Android 7.0 covers ~99% of in-market K-12 screens. Going lower (e.g. 21) means dropping `WebViewFeature.FORCE_DARK`, modern WindowInsets APIs, and `RenderProcessGoneDetail`.
- **Why not Capacitor?** Adds 12 MB of JS overhead and another build pipeline; for a kiosk app we don't need plugin marketplaces.
