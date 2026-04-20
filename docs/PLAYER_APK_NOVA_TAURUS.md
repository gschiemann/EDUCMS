# Deploying the EDU CMS Player to NovaStar Taurus controllers

## Hardware compatibility

The EDU CMS player APK is compatible with every **NovaStar Taurus series**
asynchronous controller and any generic Android 7+ device:

| Controller | SoC | ABI | Status |
|---|---|---|---|
| TB30 | Rockchip RK3288 | armeabi-v7a | ✅ supported |
| TB40 | Rockchip RK3288 or RK3399 | armeabi-v7a / arm64-v8a | ✅ supported |
| TB50 | Rockchip RK3399 | arm64-v8a | ✅ supported |
| TB60 | Rockchip RK3588 | arm64-v8a | ✅ supported |
| Generic Android 7+ tablet / stick | any | any | ✅ supported |

Our build produces per-ABI APKs via Gradle splits:

```
app-armeabi-v7a-release.apk
app-arm64-v8a-release.apk
app-x86_64-release.apk          ← emulator / dev only
app-universal-release.apk       ← safety net, ~30% larger
```

Pick the ABI that matches the Taurus board. When in doubt, grab the
`universal` APK — it contains every ABI and Android picks the right one
at install time.

## Synchronous vs asynchronous controllers

NovaStar's product line splits into:

- **Synchronous** (MCTRL, NovaPro series) — strictly hardware senders.
  They have no OS of their own; they expect an external video source
  (HDMI input). You cannot sideload an APK onto these. Drive them from
  an external Android media player or a PC running the web player.
- **Asynchronous** (Taurus TB30/40/50/60) — Android computers bolted
  onto the sender card. These are what this guide covers.

## Deploying to a Taurus controller

### 1. Download the APK

From any EDU CMS dashboard: **Settings → Download Player APK**. That URL
redirects to the latest signed release asset.

For direct download:

```
GET https://<your-api>/api/v1/player/apk/latest
```

Returns a 302 to the GitHub Release asset.

### 2. Connect to the controller

1. Plug the Taurus into power + network (same subnet as your PC).
2. Install NovaStar **ViPlex Express** on a Windows PC (free from
   novastar.tech).
3. Launch ViPlex Express and let it discover the controller.

### 3. Unlock user-software mode

This is the step that lets you sideload third-party APKs:

1. With the ViPlex Express window focused, **type `novasoft`** on the
   keyboard. That's the master key — the menu doesn't visibly change,
   but a hidden **"User Software"** panel becomes available.
2. Select the Taurus controller and log in. Default credentials:
   - Username: `admin`
   - Password: `123456` or `SN2008@+`
3. **Disable the NovaStar native player:** find the running process
   `PlayService` and stop/disable it. This ensures the native CMS
   does not compete with our APK for the frame buffer.

### 4. Sideload the APK

1. In **User Software**, click **Add** and select the downloaded
   `app-arm64-v8a-release.apk` (or `armeabi-v7a`, depending on the
   board — `Build.SUPPORTED_ABIS` on the device tells you which).
2. Check **both** options:
   - [x] Auto-launch on startup
   - [x] Automatically run after installation
3. Click **Install**.

### 5. Reboot

Restart the controller. The EDU CMS player launches automatically, shows
its registration screen, and is ready to be paired from the dashboard.

## Pixel-perfect advantage

Running the player natively on the Taurus subsystem (instead of driving
the LED wall from an external HDMI media player) gives you:

- **No EDID negotiation.** The Android app reads the canvas size
  configured in NovaLCT / ViPlex as its native display resolution.
- **No HDMI scaling or overscan.** Writing a pixel to the Android frame
  buffer maps 1:1 to the LED diode.
- **No external cable failure mode.** One less hardware hop for a
  mission-critical lockdown alert to traverse.

Particularly valuable for tight pitch (1.5mm / 1.9mm) ribbon displays
where artifacting from an external scaler is immediately visible.

## Hardware constraints to design around

Taurus boxes are optimized for 2D signage and hardware-accelerated video
decode. They are **not** a replacement for a workstation GPU. Keep the
following in mind:

- Use hardware-accelerated video via MediaCodec API. Our `WebView`
  player configures `setMediaPlaybackRequiresUserGesture(false)` and
  enables hardware composition — no action needed from the operator.
- Avoid heavy WebGL 3D scenes for Taurus deployments. The animated
  templates in this CMS are all CSS animations + simple SVG + DOM,
  which Taurus handles smoothly at 4K.
- Don't stream multiple uncompressed 4K video streams simultaneously.
  One per zone is the practical ceiling on a TB40.

## OTA updates

After the first sideload, the APK updates itself automatically. The
player worker (`OtaUpdateWorker`) pings the API every 6 hours and
whenever the device boots. If a newer version is published, it
downloads to the app's external-files directory, verifies the SHA-256,
and invokes the install intent.

On devices where EDU CMS is registered as the default installer (via
`pm set-installer com.educms.player` over ADB), the install applies
silently. Otherwise the operator sees a standard Android "Install /
Update" prompt on-screen.

### Pushing a new version

1. Tag a GitHub Release. The **Android Player APK** workflow attaches
   the built APKs to the release automatically.
2. On Railway, set these env vars on the API service:
   ```
   PLAYER_APK_LATEST_VERSION_CODE=2
   PLAYER_APK_LATEST_VERSION_NAME=1.1.0
   PLAYER_APK_URL=https://github.com/gschiemann/EDUCMS/releases/download/v1.1.0/app-arm64-v8a-release.apk
   PLAYER_APK_SHA256=<sha256 of the APK>
   PLAYER_APK_FORCED=false          # true = mandatory immediate install
   ```
3. Every paired device picks up the update within 6h or on next boot.

## Troubleshooting

### "App keeps getting killed on the Taurus"

The stock NovaStar image aggressively kills background processes. Make
sure you disabled `PlayService` per step 3 above — it reclaims the
foreground slot on a timer otherwise.

### "Pairing code doesn't appear"

Check the controller's time — Taurus boxes sometimes boot with a 2018
RTC clock. JWT verification fails if the device clock is off by more
than a few minutes. Use NovaLCT's **Set Time** or NTP sync before
pairing.

### "OTA install prompt appears every 6 hours"

You need to provision us as the default installer:

```
adb shell pm set-installer com.educms.player
```

Only works when the device is rooted or provisioned via ADB. Most
Taurus boards come root-accessible via the ViPlex login — one-time
setup per device.
