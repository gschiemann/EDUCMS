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

## Roadmap

V1 (this scaffold):
- [x] WebView shell with kiosk immersive + wake lock
- [x] Pairing flow + persistent token
- [x] Boot autostart
- [x] Renderer crash recovery
- [x] Same-origin navigation lockdown
- [x] Adaptive icon + Material 3 theme

V2 (next):
- [ ] Local asset cache (Room + WorkManager pre-fetch) — already-stubbed entities under `apps/player/app/src/main/java/com/educms/player/data` (now removed; rebuild against single namespace)
- [ ] Foreground service heartbeat (notify server every 60s)
- [ ] OTA APK self-update via APK Expansion or in-app installer
- [ ] Device-owner provisioning helper for true kiosk lockdown
- [ ] ExoPlayer for video-heavy zones (bypass WebView for HEVC/HDR)
- [ ] Local emergency cache (last 4 emergency payloads play even if offline)
- [ ] Crash reporting → Sentry (free tier shared with web)

## Notes

- **Why WebView instead of native Compose?** The web player already implements 17 themed templates, 20+ widget types, 120+ variants, drag-and-drop builder, and SSE realtime — porting all of that to Compose would take 6 months. The shell approach gets us to a sellable APK in days, and lets the web team ship updates without rebuilding the APK.
- **Why minSdk 24?** Android 7.0 covers ~99% of in-market K-12 screens. Going lower (e.g. 21) means dropping `WebViewFeature.FORCE_DARK`, modern WindowInsets APIs, and `RenderProcessGoneDetail`.
- **Why not Capacitor?** Adds 12 MB of JS overhead and another build pipeline; for a kiosk app we don't need plugin marketplaces.
