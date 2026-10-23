# Goodview GUQ (Amlogic t982) — what we can do to make VenueOS better before Brookfield ships

Read-only static analysis, 2026-10-23. No device touched, no vendor APK run, no Railway/env/DB change.
Author: Android signage-hardware specialist (Claude). Branch `research/guq-enhancements`.

## Scope and evidence base

**Launch class.** 13 Goodview GUQ panels (M43 / M55 / M65 / M75 / M86 GUQ). Spec sheets
(`~/Downloads/OneDrive_1_9-9-2026/M??GUQ/*Specs*`) read:

| Model | Panel | Refresh (spec) | OS | SoC | RAM/ROM |
|---|---|---|---|---|---|
| M55GUQ / M65GUQ | 3840×2160 | **60 Hz** | Android 11.0 | Quad-core A55 (Amlogic t982) | 4 GB / 32 GB |
| M75GUQ / M86GUQ | 3840×2160 | **60 Hz** | Android 11.0 | Quad-core A55 (Amlogic t982) | 4 GB / 32 GB |
| M43GUQ | 3840×2160 | 60 Hz (spec PDF image-only) | **Android 13** per field notes | Amlogic t982 | 4 GB / 32 GB |

So the launch GUQ fleet is **Android 11 / Chrome-95 WebView, Amlogic t982, 4 GB RAM**, except the
owner's M43 test unit which is Android 13. `Build.DEVICE = t982_ar301` (confirmed in both vendor apps).

**Artifacts decompiled** (each in its own scratch dir; jadx + apktool; static only):

| File | Package | Signer | min/target/compile SDK | versionName |
|---|---|---|---|---|
| CloudSign GVBOX (`...GVBOX_97...`) | `com.wuhan.goodview.gtv_master` | android test key (`CN=Android`, SHA-256 `c8a2e9bc…`) | 24 / 27 / 32 | CloudSign-V3.1.8 (vc 97) |
| GvSettings_GV3288A | `com.goodview.settings` | platform key (`CN=Android`, SHA-256 `2d370c21…`), `sharedUserId=android.uid.system` | 24 / 27 / 30 | V2.11.6 (vc 169) |
| CloudSign RK3288 (`...RK3288_239...`) | `com.wuhan.goodview.gtv_master` | platform key (`2d370c21…`) | 24 / 27 | CloudSign-V3.1.8 (vc 239) |

Firmware present on the Mac: `GOODVIEW_CLOUD_W86PNC-BO1082D-G_UV860QUB-N10_T982_400W_M_E_32G_release_haiwai_userdebug_20251010_095900.zip`
(1.5 GB) and `allupgrade_aml982_32G_4G_{60,65,70,75,85,90}.img`. The firmware is a monolithic Amlogic
burn image (`aml_upgrade_package`); unpacking `system.img` needs `aml_image_unpack` + `simg2img`,
which are outside the allowed toolset, so partition contents were NOT extracted. The readable manifest
(`software_check_table.txt`) confirms: Board Type `ID_BD_T982_400W_M_E`, Model `W86PNC-BO1082D-G`,
build `20251010`, TypeC bridge `LT8711UXE1`, default TZ `Asia/Shanghai`, default language english.
The RK3288 OTA images under iCloud are Android 7.1 `GV3288A` (the DH43 double-sided class, not GUQ).

> **The single most important fact in this report:** the GUQ spec is **4K60**, but every t982 unit in
> our fleet reports display mode `3840x2160@30.00` with exactly ONE supported mode, and the SoC composes
> on a 60 Hz Choreographer grid. The panel link is being driven at **30 Hz by firmware default** — 30 fps
> content on a 30 Hz output with a 60 Hz compositor is the zero-headroom, two-clock judder our 1.1.42/43
> vsync-snap work has been fighting. Fixing the output to 60 Hz is the highest-leverage display change and
> it is a per-unit firmware/menu setting, not an APK change (see §1 display, §5 step 3).

---

## 1. Vendor-private controls these boards expose, and whether OUR app can use them

There are **three** control surfaces on a GUQ, in descending order of how safe/reachable they are from a
normal (non-system, non-device-owner) app like ours:

### A. Exported broadcast intents into GvSettings (system UID) — NO permission, NO hidden API, safe

`com.goodview.settings` runs as `android.uid.system` and registers `BootCompletedRecevier`
(`exported=true`, **no `android:permission`**). Any app on the box can `sendBroadcast(...)` these and the
system-privileged settings app executes them. **CloudSign — a non-system app with the same cert class we
ship — uses exactly this path** (`com/wuhan/goodview/gtv_master/utils/APITools.java`), which is the proof
our APK can too.

| Capability | Intent action (+ extras) | Handler evidence | Our app can use? |
|---|---|---|---|
| Brightness / backlight | `com.assist.set.light` extra `light` (0–100) | `BootCompletedRecevier.onReceive` → `CommonUtils.setBrightness` → `Settings.System.putInt("brightness_v53", i)` | **Yes** (CloudSign uses it on RK3288/EP40B) |
| Volume / mute | `com.assist.set.volume` extra `volume`/`mute` | same → `Settings.System.putInt(VOL_ID_STRING, i)` | **Yes** |
| Screen orientation | `com.goodview.SET_SCREEN_ORIENTATION` (`setPackage("com.goodview.settings")`) extra `screen` | `APITools.setScreenOritention` for t982/box | **Yes** |
| Generic setting write | `com.goodview.SET_VALUE` extra key (e.g. `usb_port`) | `BootCompletedRecevier` | **Yes** |
| Reboot | `com.assist.reboot.action` | `APITools.reboot` (RK3288/EP40B path) | **Yes** on RK; t982 path uses the SDK (below) |
| Factory/clear storage | `com.goodview.CLEAR_STORAGE` | `BootCompletedRecevier` (toast only in GvSettings; real wipe in CloudSign) | possible, **do not use** |
| USB port enable | `com.assist.set.usbpower` / `com.goodview.SET_VALUE` `usb_port` | `BootCompletedRecevier` + `CommonUtils.setUsbPort` | Yes |
| Launch GvSettings UI | `com.goodview.LAUNCHER_GVSETTINGS` | `CommonUtils.launcherGvSettings` | Yes (installer convenience) |

These are the **launch-safe levers**: brightness, volume, orientation. They need no ADB and no hidden
API. Everything is `Settings.System`/`Settings.Global` writes done by the system app, so it works even
though we are a plain app.

### B. The Seewo / CVTE IFPDOS "OpenSDK" system service — the real t982 control plane

On the t982 (`isT982()`), CloudSign does **not** use broadcasts for the hard stuff; it binds the
**Seewo OpenSDK** (`com.seewo.sdk.OpenSDK` → `SDKServiceManager` → `ServiceManager.getService("opensdk")`
→ `ISDKService.Stub.asInterface`, `com/seewo/sdk/OpenSDK.java:136,166`). CloudSign is non-system, so this
binder is reachable by a normal app on these builds. The helper surface (`com/seewo/sdk/*`) is exactly
what we need:

| Helper.method (`com.seewo.sdk`) | What it does | Relevance to us |
|---|---|---|
| `SDKDeviceHelper.setScreenStatus(boolean)` / `switchScreenStatus()` | **Backlight/panel ON/OFF while the Android app and WebView keep running** | ⭐ The fix for the standby-alert hole: a dark panel whose web page is ALIVE, so an alert can wake it in <1 s |
| `SDKDeviceHelper.getPowerState()` / `setPowerState(SDKPowerState)` | Read/set power state (standby vs on) | Power schedule + alert wake |
| `SDKDeviceHelper.getAutoSleepTime()` / `setAutoSleepTime(int)` | Read/disable the **vendor auto-sleep timer** | "Sleep never" with no ADB |
| `SDKDeviceHelper.setWakeupWithSourcePluggedIn(boolean)` | Power-on-after-AC behaviour | Survive power loss / AC recovery |
| `SDKDeviceHelper.isScreenOn()` / `getCurrentLuxSensorValue()` | True panel state; ambient light | Truthful "screen on" telemetry; auto-brightness |
| `SDKPictureHelper.setBackLight(int)` / `getBackLight()` | Hardware backlight (not the Settings proxy) | Brightness on t982 (CloudSign's t982 path) |
| `SDKPictureHelper.getResolutionInfo()` / `is4k2kResolution()` / `getPictureMode()` / `isSolution…Supported` | **Panel's real resolution + picture/aspect mode** | ⭐ Detect the 4K60-vs-30 state; read picture mode / MEMC-ish "solution" modes |
| `SDKSystemHelper.reboot()` | Reboot | t982 reboot (CloudSign uses this, not the broadcast) |
| `SDKSystemHelper.addPowerControlTask(SDKPowerControlTask)` / `clearPowerControlTask()` / `getPowerControlTask(i)` | **The vendor's own on/off SCHEDULER** | ⭐ Set/clear it so our schedule and the vendor's never fight (the nightly-reboot / scheduled-restart problem) |
| `SDKSystemHelper.getPanelVersion()` / `getMcuVersion()` / `getBoardType()` / `getMainCodeVersion()` | Firmware/MCU/panel versions | Fleet inventory, OTA decisions |
| `SDKSystemHelper.executeShellCommand(String)` / `executeCommandWithRoot(String)` | Shell channel | Powerful; **avoid** unless no API exists |
| `SDKSystemHelper.getScreenShot(Context)` → `Bitmap` | Screenshot | Remote "what's on glass" proof |
| `SDKSystemHelper.freezeScreen()` | Freeze last frame | Could hide a reload seam (not needed; native-first solves it) |

**Caveats, stated honestly:**
- `ServiceManager.getService` is on the Android hidden-API blocklist from API 28+. CloudSign reaches it
  on these Goodview builds (the SDK may rely on a relaxed-enforcement vendor build, a greylist exemption,
  or a reflection bypass). **This must be proven on glass before we rely on it** — bind once, confirm the
  binder is non-null, and fall back silently if it is. The broadcast path (A) needs no hidden API and is
  the guaranteed-safe fallback for brightness/volume/orientation.
- The SDK is CVTE/IFPDOS firmware-specific. On a non-Seewo panel `getService("opensdk")` returns null;
  every call must be guarded and absence treated as "capability unavailable," never a crash (matches our
  self-heal rule). `getResolutionInfo()`/`getBoardType()` are the cheap probes that tell us which path a
  given unit supports.

### C. The GvManager AIDL (`GV_API_SERVICE`) — generic fallback, same reachability

`GvSettings.UpgradeService.onCreate` does `ServiceManager.addService("GV_API_SERVICE", new ApiService(...))`
(`com/goodview/settings/UpgradeService.java:418`). `ApiService extends IGvInterface.Stub` with **no
permission check in any method / onTransact**. Clients call `GvManager.getInstance()` →
`ServiceManager.getService("GV_API_SERVICE")` (`com/goodview/sdk/GvManager.java:88`). CloudSign uses it
as its non-t982 fallback (`APITools` → `GvManager.getInstance().setBrightness/.setVolume/.reboot/.setScreenRotate/.setUsbStatus/.setConfiguration`).

Full `IGvInterface` surface (`com/goodview/sdk/IGvInterface.java`): `reboot()`, `poweroff()` (sends
KEYCODE_POWER 26 / 141), `screenshot(path)` / `takeShot(int,path)`, `setBrightness/getBrightness`,
`setVolume/getVolume`, `setScreenRotate/getScreenRotate`, `isScreenOn`, `installApk(path)`,
`setEthernetEnable(bool)`, `selectNetwork(int)`, `setUsbStatus/getUsbStatus`, `sendKeyEvent(int)`,
`execShellCmd(String)` (!), `getResolution()`, `getSystemProperties/setSystemProperties(key,val)`,
`getConfiguration/setConfiguration`, `getFirmwareVersion/getWebViewVersion/getTotalMemory/getDeviceBoard/getDeviceSN/getMacAddr/getIPAddr`.
Same hidden-API caveat as B; same guard-and-fallback rule.

### What is NOT reachable (never, without system signature / device owner / root)

- **Changing the panel's default display mode / refresh rate system-wide** (the 30→60 Hz fix). We can
  *read* it (`getResolutionInfo`, `/sys/class/display/mode`, `/sys/class/amhdmitx/amhdmitx0/disp_cap`) and
  request a preferred mode for OUR window (`Window.preferredDisplayModeId`, `Surface.setFrameRate`), but
  the firmware's default output mode is a **vendor factory-menu setting**, done on the glass per unit.
- Device-owner-only: forced home app / kiosk lock-task without a confirmation, silent Wi-Fi provisioning,
  system-wide reboot without the vendor path, locale. (And per owner decision 2026-10-17, **we never set
  device owner** anyway.)
- Manual clock set (`SET_TIME` is privileged). Auto-time / NTP need the one-time ADB `WRITE_SECURE_SETTINGS`
  grant already inventoried in `05-android-settings-without-device-owner.md`.

---

## 2. What CloudSign does that steals decode/CPU/memory from us, and how to stop it

**Observed symptom (field, 2026-10-20):** after Goodview content was cleared, GUQ drops fell sharply
(GUQ55 361→2 late on M86-class). The counters say these are **decode stalls, not pacing**
(`maxSubmitGapMs` 669–827 ms, `droppedFrames` 40–344, `snapErrorMaxUs` ≤ 12) clustering after page
reload / Resync / all-clear — the signature of **CPU/decoder/memory contention on a 4 GB box**.

**What CloudSign runs** (`com.wuhan.goodview.gtv_master`, manifest + sources):
- A **KeepAliveService** started `startForegroundService` from `MainActivity` (:1736) — a persistent
  foreground service.
- `services.SocketService` (Netty server socket), `services.IotBusiness` (EventBus IoT loop),
  `services.FloatWindowService` (`exported=true`) and `services.FloatingMenuService` (overlay windows via
  `SYSTEM_ALERT_WINDOW`).
- `schedule.ReportJobScheduler.startPeriodicReport` (JobScheduler) + `clock.AlarmManagerUtil` alarms
  (e.g. a daily refresh alarm at 23:59, `MainActivity:832`).
- Numerous registered receivers (SCREEN_ON, sleep, USB, package-replace) and ~23 files using
  `ScheduledExecutorService`/`Timer`/`setRepeating`.
- It declares itself a **HOME / COMMON_HOME launcher** (`MainActivity` intent-filter) and holds
  `REQUEST_INSTALL_PACKAGES` + a `StaticUpgradeReceiver` on `MY_PACKAGE_REPLACED` — so it can wake and
  auto-update itself.

On a GUQ our player is already the home app (GUQ Tuesday checklist), so CloudSign is not the active
launcher — but its services still autostart (GvSettings' `CommonUtils.autoStart` launches the configured
`boot_pkg_name`, and CloudSign's own receivers re-arm it), and a running CloudSign still holds a decoder
session, foreground service, sockets and timers on a 4 GB box.

**Reversible ways an installer disables it (per unit):**
1. **Preferred (remote-friendly, fully reversible):** Settings → Apps → *CloudSign* → **Disable** (or
   **Force stop** if Disable is greyed). Reverse with Enable. On the glass with a remote this is a few
   D-pad steps.
2. **ADB (cleanest, survives reboot, reversible):**
   `adb shell pm disable-user --user 0 com.wuhan.goodview.gtv_master` — reverse with `pm enable`.
   Also disable the Goodview launcher if present: `com.goodview.launcher`. Do **not** disable
   `com.goodview.settings` — it is the system settings/OpenSDK host we want to *use* (§1).
3. **Stop autostart:** in GvSettings set the boot app (`boot_pkg_name`) to our player, or clear CloudSign's
   `boot_auto_launcher`. (GvSettings exposes `BOOT_PKG_NAME` / `BOOT_AUTO_LAUNCHER` keys.)

**Can our app detect it running?** Yes, cheaply and without `QUERY_ALL_PACKAGES`:
`PackageManager.getPackageInfo("com.wuhan.goodview.gtv_master", 0)` tells us it is installed, and
`getApplicationEnabledSetting(...)` tells us whether it is enabled. We can surface a drawer/telemetry
line "Vendor player present & enabled — recommend disabling" so the fleet view flags any GUQ where the
contention risk is live. (`ActivityManager.getRunningAppProcesses` is unreliable on A11, so use the
package-enabled state, not process scanning.)

---

## 3. How Goodview plays 4K on t982 vs our native engine — anything to copy?

**Goodview's t982 video path** (`com/wuhan/goodview/gtv_master/views/video/VideoViewBitmap982.java`,
`ViewFactory.java`):
- `android.media.MediaPlayer` rendering into a **`TextureView`** (the `982` variant; other boards use a
  `SurfaceView`). `ViewFactory` holds **two `MediaPlayer`s** (`g`/`h`) and two surfaces — a classic
  pre-prepared "next player" for crossfade/seamless transitions.
- **No ExoPlayer, no MediaCodec-direct, no tunneled playback, no `setVideoScalingMode` call, no
  `setPlaybackParams`.** `onVideoSizeChanged` is empty. Scaling is just the view's `fitXY` / default
  `VIDEO_SCALING_MODE_SCALE_TO_FIT`.
- There is a vendor `MMediaPlayer.setVideoDisplayAspectRatio(EnumVideoAspectRatio)` API in the tree, but
  **no app call site selects it** (consistent with Codex's 07-goodview-fit-research.md).

**Verdict: our native engine (`apps/player/.../media/FaceVideo*.kt`: MediaCodec decode straight to a
SurfaceView below a per-face WebView, EOS-rewind single-decoder loop, vsync-snapped release on a measured
Choreographer grid, SHA-verified on-disk store) is already more sophisticated than Goodview's app.** We
should NOT copy their MediaPlayer path. Two narrow things worth noting:

1. **The 30 Hz output is the real enemy, not the decoder.** Goodview's own player would judder the same way
   at 30 Hz output on a 60 Hz compositor; they likely avoid it because a stock MediaPlayer+TextureView at
   30 fps is less sensitive to half-period drift than our tight release scheduler, OR because on their
   units the output is actually at 60 Hz. The t982 decoder (`OMX.amlogic.avc.decoder.awesome2` /
   `c2.amlogic.avc.decoder`) is fine — our field data shows clean pacing once snapped; the residual chop is
   the 30 Hz link + contention (§2). **The copyable insight is the display mode, not the player.**
2. **TextureView on 982.** Goodview uses a TextureView (GPU-composited) rather than a SurfaceView overlay on
   this exact SoC. Our above-window SurfaceView path is better for power/latency, but if a future t982 unit
   ever shows overlay-plane problems, TextureView is the vendor-proven fallback for this chip. Not needed
   now (our above-window path is clean on t982 in soak).

---

## 4. Prioritized enhancements (value × risk × effort)

Tags: **[server]** server/web only · **[apk]** needs a new APK bridge/engine change · **[setup]** installer
step on the unit · **[no]** not possible without system signature. All respect: no device owner;
auto-detect, no operator setting; emergency alerting must never break.

| # | Enhancement | Value | Risk | Effort | Tag |
|---|---|---|---|---|---|
| 1 | **Drive GUQ output at 4K60.** Panels are 60 Hz but default to 30 Hz. Per-unit: read `/sys/class/display/mode` + `amhdmitx disp_cap` + `SDKPictureHelper.getResolutionInfo()`, and set 2160p60 in the vendor factory menu. Removes the 30-on-30 judder our vsync-snap fights. | ★★★★★ | Low (menu setting; blanks ~1 s) | Low (per unit) | **[setup]** (read also **[apk]**) |
| 2 | **Backlight-based standby via `SDKDeviceHelper.setScreenStatus(false/true)`** instead of device-admin lockNow or vendor sleep. Panel goes truly dark but the Android app + WebView + alert watch stay ALIVE, so an alert wakes the glass in <1 s. Fixes the standby-alert hole (dead web page can't wake). Auto-detected per device (Seewo SDK present → use it; else keep-screen-on only). | ★★★★★ | Med (must prove alert-over-standby on glass; emergency-first) | Med | **[apk]** |
| 3 | **Disable/neutralise CloudSign on every GUQ** (`pm disable-user` or Settings→Disable) + detect-and-flag if present. Removes the decode/CPU/memory contention that caused the GUQ drop spikes. | ★★★★★ | Low (reversible) | Low | **[setup]** + **[server]** (detect/flag) |
| 4 | **Own the power schedule via `SDKSystemHelper.addPowerControlTask`/`clearPowerControlTask`** so our on/off schedule and the vendor's scheduled restart never fight (the nightly-reboot problem). Clear vendor tasks, write ours; auto-detected. | ★★★★☆ | Med | Med | **[apk]** + **[setup]** (clear vendor nightly in menu as belt-and-braces) |
| 5 | **Brightness control** via `com.assist.set.light` broadcast (no hidden API) with `SDKPictureHelper.setBackLight` as the t982 fast path. Enables scheduled/ambient dimming; proven reachable by a non-system app. | ★★★★☆ | Low | Low | **[apk]** |
| 6 | **Truthful panel telemetry**: report `getResolutionInfo`/refresh, `getPanelVersion`/`getMcuVersion`/`getBoardType`, `isScreenOn`, firmware string, and "vendor player enabled" on the fleet/Overview. Turns the 30-Hz question and contention into something the dashboard shows, not a guess. | ★★★★☆ | Low | Low–Med | **[apk]** + **[server]** |
| 7 | **Native-first qualification on the GUQ class** (the launch gate): one GUQ enrolled Tuesday, §7 E1–E7 emergency drills over native, 72-h soak. The GUQ class has never run native cleanly; this is the "up with the best" bar. | ★★★★★ | High (emergency invariants) | High | **[apk]** (already in flight) + glass |
| 8 | **Orientation lock** via `com.goodview.SET_SCREEN_ORIENTATION` for portrait GUQ installs, auto-applied from the screen's configured rotation (no ADB). | ★★★☆☆ | Low | Low | **[apk]** |
| 9 | **Remote screenshot proof** via `SDKSystemHelper.getScreenShot`/`IGvInterface.screenshot` — "what is actually on the glass" for support, gated to admins/audited. | ★★★☆☆ | Low | Med | **[apk]** + **[server]** |
| 10 | **Reboot as an explicit recovery action** via `SDKSystemHelper.reboot()` (t982) — a real remote reboot without device owner, audited, never automatic during content/alert. | ★★★☆☆ | Med | Low | **[apk]** |
| 11 | **Vendor OTA / auto-update OFF** on each unit (GvSettings `UpgradeService` + Seewo/CVTE updaters) so a vendor push never replaces firmware/launcher under us. | ★★★★☆ | Low | Low | **[setup]** |
| 12 | **Auto-sleep timer OFF** via `SDKDeviceHelper.setAutoSleepTime(0)` + vendor menu, so the panel never self-sleeps outside our schedule. | ★★★☆☆ | Low | Low | **[apk]** + **[setup]** |
| 13 | Picture-mode normalisation (`getPictureMode`/solution modes) to a signage-correct mode (not "vivid"/MEMC-smoothed) so all 13 look identical. Read-only until proven. | ★★☆☆☆ | Med (per-model support varies) | Med | **[apk]** + **[setup]** |
| — | Change the firmware **default** display mode from software | — | — | — | **[no]** (factory menu only; enhancement #1 covers the reachable version) |

**Design rules for the [apk] items (per binding owner decisions):** every vendor call is wrapped in a
`GoodviewVendorPort` that (a) auto-detects support per device from its own facts (board type, SDK/service
presence, `getResolutionInfo`), (b) exposes NO operator setting — the engine/behaviour is decided by the
device, flags are lead-only kill switches, (c) fails silently to the broadcast path or to no-op if the
vendor service is absent, and (d) is held/removed before any emergency alert draws (rule 11). Nothing in
§1–§4 is allowed to delay or hide an alert; the standby item (#2) specifically keeps the web layer alive
*so that* alerts work, which is the opposite of the device-admin lockNow path that broke L55VEC.

---

## 5. Per-unit setup checklist for the 13 GUQ units

Remote-friendly (D-pad) steps first; ADB steps marked. Do each on every unit; record the menu path with a
photo the first time so we can write the permanent installer runbook. "Verify" = how to confirm it took
(dashboard telemetry read by the lead, or on-glass).

| # | Step | Why | How | Verify |
|---|---|---|---|---|
| 1 | **Set display output to 2160p **60 Hz**** | Panels are 60 Hz but default to 30 Hz → judder. | Vendor factory/Display menu → output mode 2160p60. (ADB read first: `adb shell cat /sys/class/display/mode` and `.../amhdmitx0/disp_cap`.) | Player telemetry `displayMode`/`supportedModes` shows a 60 Hz mode and the active mode is 60; late/off-cadence frames drop. |
| 2 | **Disable/neutralise CloudSign** (and `com.goodview.launcher` if present) | Removes decode/CPU/memory contention on the 4 GB box. | Settings → Apps → CloudSign → Disable; or ADB `pm disable-user --user 0 com.wuhan.goodview.gtv_master`. **Keep `com.goodview.settings`.** | Fleet "vendor player enabled" flag clears; GUQ dropped-frame spikes after reload/Resync disappear in soak. |
| 3 | **Vendor OTA / auto-update: OFF** | A vendor push must never replace firmware/launcher under us. | Vendor/Settings → system update / auto-update → Off; Seewo/CVTE updater off if shown. | No unexpected version/launcher change over 72-h soak. |
| 4 | **Vendor scheduled restart / power timer: OFF** (we own the schedule) | Nightly vendor restart fights our schedule and interrupts content. | Vendor menu → scheduled power / restart → Off (GvSettings `reboot_time_switch`). Later we also clear it via `clearPowerControlTask`. | No `boot reason=reboot` at the vendor's hour; one native session across the quarter-hour ticks. |
| 5 | **Auto-sleep / screensaver / daydream: OFF** | Panel must not self-sleep or screensaver outside our schedule. | Settings → Display → Screensaver Off; vendor auto-sleep Off. | Panel stays on; no screensaver after idle. |
| 6 | **HDMI-CEC: OFF (and identical across units)** | Avoid CEC auto-wake/sleep surprises (GUQ55 had CEC on, GUQ65 off). | Settings/vendor → CEC → Off. | Note in runbook; no spontaneous wake/sleep. |
| 7 | **Power-on state after AC loss: ON** (not standby/last-state) | Screen must come back by itself after a power cut. | Vendor System/Power menu → power-on state → On; (later `setWakeupWithSourcePluggedIn(true)`). | Pull plug 30 s → content returns, no splash/card. |
| 8 | **Timezone set to the venue's** | Default firmware TZ is `Asia/Shanghai`; schedules/clock would be wrong. | Settings → Date & time → set zone; auto-time via one-time ADB `pm grant com.educms.player android.permission.WRITE_SECURE_SETTINGS` then `auto_time`/`auto_time_zone`/`ntp_server`. | Clock widget + schedule fire at venue-local time. |
| 9 | **Confirm VenueOS is the HOME app** | Boot-to-player; vendor launcher must not win. | Already home on GUQ; if not, set default home to the player (or GvSettings `boot_pkg_name`). | Reboot → player boots directly, no launcher flash. |
| 10 | **Install the launch player** (1 tap per unit — Android 11) | GUQ are API 30; silent install needs installer-of-record which these predate. | Approve the Android "Install?" prompt when the update card appears; NEEDS_TAP copy guides it. | `player_version` flips to the launch build; push row clears. |
| 11 | **(Optional ADB, support) network ADB on** | Cable-free support later. | `pm grant ... WRITE_SECURE_SETTINGS` then `settings put global adb_wifi_enabled 1`. | ADB-over-Wi-Fi connects. |
| 12 | **Emergency drill over the running engine** | Life-safety gate: alert ≤1 s, content yields before alert draws, all-clear restores with one takeover; repeat with panel asleep (backlight standby, #2) to prove the alert wakes it. | Dashboard device-scope DRILL; repeat asleep. | On glass + telemetry; this is the launch gate, not optional. |

**Order on site:** settings block (1–9) → install (10) → drills/soak (12). The display-mode change (#1)
and CloudSign disable (#2) are the two that most change the glass; do them first and re-read telemetry.

---

## Appendix — source locations (for the next agent)

- Vendor control broadcasts our app can send: `gvbox_jadx/.../utils/APITools.java` (`setBrithless` :907,
  `setVolume` :1114, `setScreenOritention` :985, `reboot` :854) and GvSettings
  `com/goodview/settings/BootCompletedRecevier.java` (handler), `CommonUtils.java` (setBrightness :1574,
  setVolume, autoStart :531, board detection `isAML982` :1667 = `t982_ar301`, Property keys :220).
- Seewo OpenSDK: `gvbox_jadx/.../com/seewo/sdk/OpenSDK.java` (binds `getService("opensdk")` :166),
  `SDKDeviceHelper.java` (setScreenStatus :90, setAutoSleepTime :74, getPowerState :50),
  `SDKPictureHelper.java` (setBackLight, getResolutionInfo :115, is4k2kResolution :131, getPictureMode :111),
  `SDKSystemHelper.java` (reboot, addPowerControlTask :106, executeShellCommand :119, getScreenShot :264,
  getPanelVersion :245).
- GvManager AIDL: `gvsettings_jadx/.../com/goodview/sdk/GvManager.java` + `IGvInterface.java`;
  registered in `com/goodview/settings/UpgradeService.java:418`; implemented `com/goodview/settings/ApiService.java`.
- Media path: `gvbox_jadx/.../views/video/VideoViewBitmap982.java` (MediaPlayer + TextureView),
  `ViewFactory.java` (dual MediaPlayer).
- Firmware: `software_check_table.txt` (board `ID_BD_T982_400W_M_E`, build 20251010); spec PDFs
  `~/Downloads/OneDrive_1_9-9-2026/M??GUQ/*Specs*` (all 3840×2160 @ 60 Hz, Android 11, 4 GB).
- APK hashes: GVBOX `df298b73…`, GvSettings `b646c457…`, RK3288 `5284cb11…`.

**Not done (out of scope / tools):** firmware `system.img` partition contents (needs `aml_image_unpack`),
and any on-glass verification — none of §1–§5 is hardware-qualified; every [apk]/[setup] item needs the
Tuesday-style on-glass proof, emergency drills included, before we rely on it.
