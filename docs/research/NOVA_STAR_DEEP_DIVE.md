# NovaStar Taurus Deep Dive — TB30 / TB40 (TB50 / TB60) for Sideloaded Android Player APKs

**Audience:** Engineers shipping a Kotlin/WebView Android signage app onto NovaStar
Taurus boxes that NovaStar themselves do not officially document for third-party
deployment.

**Status:** Research compiled 2026-05-06 from public NovaStar PDFs, third-party
integrator documentation, and field reports. Where a claim is uncertain, it is
marked **`[uncertain]`** with the strongest evidence available.

**Reading guide:** Sections 1-2 are reference. Section 3 is the operational sideload
recipe. Sections 4-5 are kiosk hardening and network tuning (where the school-WiFi
issue described in the brief lives). Section 7 is "things that have already gone
wrong for everyone else." Section 9 is the executive action list — read first if
you only have five minutes.

---

## 1. Hardware identity matrix

The Taurus line has gone through at least three SoC generations. **The most
important takeaway is that current-production (2024-2026) TB30 and TB40 boards no
longer ship the RK3288 our existing docs assert** — they ship a quad-core Cortex-A55
(per NovaStar's own 2024 spec PDFs). That is a 64-bit core; armv7-only APKs run
in compat mode, which works but throws away half the cache and most of the perf
headroom.

| Model | Era | SoC family | Cores / clock | RAM | Storage | Pixel cap | HDMI in/out | Audio | OS |
|---|---|---|---|---|---|---|---|---|---|
| TB1-4G / TB2-4G | gen-1 (≤2020) | Rockchip (RK3288) **`[uncertain]`** | quad A17 / 1.6 GHz | 1 GB | 8 GB | 0.65M / 1.3M px | none / none | 3.5mm | Android (gen-1 image, exact ver. unverified) |
| TB30 (current) | gen-3 (2024) | quad-core ARM Cortex-A55 @ 1.8 GHz | quad A55 | 1 GB | 16 GB | 0.65M px | **none** | 3.5mm stereo | Android **11** |
| TB40 (current) | gen-3 (2024) | quad-core ARM Cortex-A55 @ 1.8 GHz | quad A55 | 1 GB | 32 GB | 1.3M px | HDMI 1.4 in + loop-out | 3.5mm stereo (48 kHz fixed) | Android **11** |
| TB50 (current) | gen-3 | A55 family | likely octa-core / 8 GB **`[uncertain]`** | larger | larger | 1.3M px | HDMI 1.4 | 3.5mm | Android 11 **`[uncertain]`** |
| TB60 (current) | gen-3 | A55 family | larger | larger | larger | 2.3M px | HDMI 1.4 | 3.5mm | Android 11 **`[uncertain]`** |

**Sources:**
- [TB40 Multimedia Player Specifications V1.2.1 (NovaStar PDF, 2024)](https://oss.novastar.tech/uploads/2024/11/TB40-Multimedia-Player-Specifications-V1.2.1.pdf)
- [TB30 Multimedia Player Specifications V1.1.0 (NovaStar PDF, 2024)](https://oss.novastar.tech/uploads/2024/06/Taurus-Series-Multimedia-Player-TB30-Specifications-V1.1.0.pdf)
- [LEDinCloud — One Box, Two Jobs (TB40 Android 11 confirmation)](https://www.ledincloud.com/novastar-tb40/)
- [LED Screen Board NovaStar Multimedia Player Guide](https://www.ledscreenboard.com/novastar-multimedia-player-guide/)
- [NovaStar TB30 user manual mirror](https://www.creativescreentv.com/wp-content/uploads/2024/01/NovaStar-TB30-User-Manual.pdf)

### 1.1 ABI implications

A Cortex-A55 SoC supports both `armeabi-v7a` (32-bit) and `arm64-v8a` (64-bit).
NovaStar's Taurus image is presumed to be a 64-bit Android 11 build (Android 11
itself dropped 32-bit-only support on most devices), but **NovaStar does not
publish `Build.SUPPORTED_ABIS` and we have no field-confirmed `getprop` dump.**
The safe path on a fresh Taurus is:

1. First-install attempt: push `app-arm64-v8a-release.apk`.
2. Fallback if PackageManager rejects (`INSTALL_FAILED_NO_MATCHING_ABIS`):
   push `app-universal-release.apk` (~30% bigger, contains every ABI).
3. Older RK3288-era Taurus boxes (TB1/TB2/T-series, RK3288 Cortex-A17) only
   accept `armeabi-v7a` and **may not run an Android-11-targetSdk APK at all**
   if they're still on the gen-1 image (Android 7 era, **`[uncertain]`**).

**Action item:** When the player first boots, log
`Build.MODEL`, `Build.SUPPORTED_ABIS`, `Build.VERSION.SDK_INT`,
`Build.PRODUCT`, `Build.HARDWARE`, and the Chromium WebView package version
back to our API. After a few real-world deploys we'll have ground truth and
can stop flying blind.

### 1.2 WebView / Chromium version

NovaStar publishes a "Multimedia Player WebView Upgrade Guide" implying the
shipped WebView is **older than current Chromium** and operators are expected
to update it manually if they want modern web compat. The exact version-on-disk
is undocumented; one third-party reseller blog page describes a "WebView
upgrade" as a step that "improves H5 pages, web streaming, and third-party app
compatibility" — strongly implying the factory image's WebView is stale.

**Cite:**
- [LEDinCloud Taurus overview — references WebView upgrade flow](https://www.ledincloud.com/novastar-taurus-multimedia-players/)
- [SinaPlug — WebView upgrade is part of the recommended setup](https://www.sinaplug.com/products/novastar-taurus-tb40-controller)

The mctrlvp.com "Multimedia Player Webview Upgrade Guide" (Section 7 below) is
the primary how-to, but the page reliably refused to load during this research
session. Operators report it documents an APK install of a newer
"Android System WebView" via the same User Software path used for third-party
APKs.

---

## 2. TaurusOS — what's actually running

**"TaurusOS" is the marketing name for NovaStar's vendor build of Android 11.**
There is no public AOSP-style site, no source repo, and no separate version
number that we've found. Practically what makes it "Taurus" instead of stock
AOSP:

- **No Google Mobile Services / Google Play.** Standard for industrial Rockchip
  builds — vendors don't pay for GMS certification. Anything that imports the
  Play services SDK at runtime (Maps, Firebase Messaging, FCM push, In-App
  Updates, sign-in) will fail. Use HMS-free libraries; for push, fall back to
  WebSocket or HTTP polling (we already do).
- **No traditional launcher / app drawer.** First-party home is `PlayService`,
  which is the NovaStar player (the thing that renders content from VNNOX /
  ViPlex). It registers itself as the `CATEGORY_HOME` activity. There is no
  Android Settings tile, no notification shade, no Recents key. This is by
  design — operators are not supposed to interact with the OS directly.
- **`NovaLauncher`** is the actual launcher app; SmartPlayer's third-party
  install guide warns that if you replace it, ViPlex no longer works. This is
  the gotcha behind "I installed Nova Launcher and now ViPlex can't see the
  device" reports.
- **ADB is OFF by default.** Has to be turned on via the hidden ViPlex panel
  (see section 3.4). Once on, it serves over the LAN on standard port 5555,
  no USB connector exposed for adb on most Taurus models (USB-B port is
  ViPlex-only).
- **Root is NOT directly exposed.** `adb shell` lands you in a normal-user
  shell. There is no documented root-shell escape from ViPlex. Field rumor:
  a service account named `novastar` exists but the password is firmware-
  version-dependent and not publicly documented **`[uncertain]`**.
- **Network: Wired Ethernet > Wi-Fi STA > 4G modem.** Default behavior on the
  Ethernet port is DHCP-on-bring-up. If DHCP fails, it does NOT fall back to
  link-local — the box just sits with no network, **and its captive-portal
  behavior is undocumented** (see §5).
- **Default Wi-Fi AP**: SSID `AP<last 8 of SN>`, password printed on the SN
  label. Often `12345678` factory default. Useful to ViPlex into the box from
  a phone before you've configured station-mode WiFi.

**Sources for the above:**
- [SmartPlayer wiki — Novastar TB30 install guide (NovaLauncher gotcha)](https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en)
- [OnSign — NovaStar Taurus install (default credentials, PlayService model)](https://docs.onsign.com/android/novastar-taurus-android)
- [LEDinCloud — TB1-4G overview ("third-party applications cannot be installed on the system")](https://www.ledincloud.com/novastar-tb1-4g/) — note this is incorrect for current Taurus; reflects gen-1 limitations
- [LEDinCloud — common LED media player passwords](https://www.ledincloud.com/led-media-player-software-login-passwords/)

---

## 3. Sideloading paths — the operational recipe

Three known paths. (1) is the only one NovaStar tacitly tolerates. (2) is what
to do when ViPlex can't see the device for some reason. (3) is mostly
theoretical without a USB-A keyboard plus a serial cable.

### 3.1 Path A — ViPlex Express + the `novasoft` keystroke (RECOMMENDED)

This is the canonical path. Reliability is high in 2024-2026 ViPlex Express
versions (V2.25 through V3.0 are the publicly-documented ones; the keystroke
has worked unchanged for at least four years).

1. Install ViPlex Express on a Windows PC. Latest is **V3.0.0** (Aug 2024 user
   manual). V2.26.0 is the most-cited reference version. ViPlex needs
   **.NET Framework 4.6.x** and **VC++ 2017 Runtime** preinstalled.
2. Same LAN as the Taurus. Plug the box into the school's wired network or its
   Wi-Fi AP (`AP<last8>` / `12345678`).
3. Launch ViPlex Express.
4. **With the main window focused, type `novasoft` — blind, no input field
   visible.** A "User Software" tab appears in the left-hand nav.
5. Click User Software → pick the Taurus → Connect. Login dialog:
   - **`admin` / `123456`** for older firmware
   - **`admin` / `SN2008@+`** for **firmware V4.6.0 and later** (this is now
     the documented default for current production Taurus boxes)
   - If neither works: ViPlex sometimes accepts `admin / 12345678` as the
     fallback factory default on first contact **`[uncertain]`**
6. **Disable PlayService.** This stops the NovaStar player so it can't
   reclaim the foreground while you install. Do NOT skip this — the install
   itself works without it but the post-install autostart will lose to
   PlayService respawn.
7. Click Add → pick the APK → enable **both** checkboxes:
   - [x] Auto launch on startup
   - [x] Automatically run after installation
8. Install.
9. Restart Now from ViPlex.

**Cites:**
- [SmartPlayer — TB30 install (the canonical novasoft + Selftest sequence)](https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en)
- [OnSign Taurus install — same sequence, different APK](https://docs.onsign.com/android/novastar-taurus-android)
- [ViPlex Express V3.0.0 Async Mode User Manual (Aug 2024)](https://oss.novastar.tech/uploads/2024/08/ViPlex-Express-Async-Mode-User-Manual-V3.0.0.pdf)

### 3.2 Path B — ADB push + install (WHEN ViPlex CAN'T SEE THE DEVICE)

ADB is OFF by default. To enable it you still need ViPlex once. Then it stays
on across reboots.

1. ViPlex User Software panel (Path A through step 5).
2. **In addition to typing `novasoft`, ALSO type `selftest`.** This unlocks
   the "Debug mode" panel on top of User Software. ([SmartPlayer wiki](https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en))
3. Toggle the ADB switch — green = enabled.
4. Right-click the device → "Debug tool". This is ViPlex's bundled adb wrapper.
5. From a real shell on the same LAN:
   ```
   adb connect <taurus-ip>:5555
   adb -s <taurus-ip>:5555 install -r app-arm64-v8a-release.apk
   adb -s <taurus-ip>:5555 shell am start -n com.educms.player/.MainActivity
   ```
6. To survive reboot via ADB-only path:
   ```
   adb shell pm enable com.educms.player
   adb shell cmd appops set com.educms.player REQUEST_INSTALL_PACKAGES allow
   ```

**`REQUEST_INSTALL_PACKAGES`:** ViPlex grants this implicitly when it
installs via its own session — that's how OTA self-update works post-install.
For ADB installs you have to grant it manually as above. We've seen this gotcha
on Goodview boxes too.

### 3.3 Path C — USB stick auto-install (UNCONFIRMED FOR APKs)

NovaStar documents USB sticks for content sync (USB 3.0 Type-A, FAT32 or Ext4,
specific folder layout). **No public NovaStar doc confirms USB auto-install of
arbitrary APKs.** Some integrator forums mention a `/sdcard/install/auto.apk`
hot-folder convention on Rockchip industrial Android builds in general. Treat
as `[uncertain]` — do not rely on this path.

### 3.4 Default credential matrix (cheat-sheet)

| Surface | User | Password (current prod) | Password (legacy) |
|---|---|---|---|
| ViPlex / web admin | `admin` | `SN2008@+` (V4.6.0+) | `123456` |
| Wi-Fi AP | n/a | label-printed; often `12345678` | `12345678` |
| ADB shell | unprivileged | n/a | n/a |
| Root shell | not exposed | — | — |

**Cites:**
- [LEDinCloud — Common LED media player software login passwords](https://www.ledincloud.com/led-media-player-software-login-passwords/)
- [Westan Australia — Novastar Taurus Access KB](https://support.westan.com.au/portal/en-gb/kb/articles/novastar-taurus-access)

### 3.5 Replacing the launcher

You can install Nova Launcher / Lawnchair via Path A. **DO NOT do this on a
production Taurus** — `NovaLauncher` is required for ViPlex to function
correctly per SmartPlayer's wiki. If you replace home and your APK then
crashes, the box has no UI to recover with and you're shipping it back to
the operator's PC for a ViPlex rescue. The recommended pattern is to make
**your own APK** the home activity (CATEGORY_HOME, see §4.1) and leave
NovaLauncher installed but no longer auto-selected.

---

## 4. Auto-launch / kiosk-survival

This is where the brief's "PlayService re-spawning and stealing focus"
question lives. Three layers, in order of strength:

### 4.1 ViPlex's "Auto-launch on startup" checkbox (weak)

This sets a NovaStar-internal flag that asks PlayService **not** to launch
itself on boot, and starts your APK instead. Reliability: medium. Operators
report it works initially but PlayService can still grab focus on a sync or
firmware-pull event. Should be considered a hint, not a guarantee.

### 4.2 Register your APK as `CATEGORY_HOME` (medium)

Add to your manifest:
```xml
<activity android:name=".MainActivity">
  <intent-filter>
    <action android:name="android.intent.action.MAIN"/>
    <category android:name="android.intent.category.HOME"/>
    <category android:name="android.intent.category.DEFAULT"/>
    <category android:name="android.intent.category.LAUNCHER"/>
  </intent-filter>
</activity>
```

If our APK is the only registered home activity and PlayService is disabled,
Android picks ours unconditionally. If PlayService is *also* registered as
home, Android shows the launcher chooser dialog the first time the home key
fires and it persists from there. **The only-home-app trick works if you
disable PlayService via Path A step 6 BEFORE rebooting** so the chooser never
sees PlayService as a candidate.

### 4.3 Device Owner provisioning (strongest, but conditional)

If we can run `adb shell dpm set-device-owner com.educms.player/.AdminReceiver`
once, we get:
- `startLockTask()` — true kiosk lock, hardware home/back/recents are
  swallowed by our app
- Silent APK install (no Android dialog on OTA)
- Force-disable any other app, including PlayService, regardless of NovaStar's
  internal flags
- Power-button / volume-button suppression

**Constraint:** `dpm set-device-owner` requires:
1. No Google account on the device (check on Taurus — none ships, so OK).
2. No existing device admin (Taurus has none, so OK).
3. Either fresh-from-factory OR factory-reset state (Taurus has no
   factory-reset menu accessible without ViPlex — but `adb shell pm clear`
   the relevant accounts).

**Status with Taurus:** Highly likely to work, **never confirmed in the wild**
on a Taurus by anyone we found. Worth a one-shot test on a sacrificial unit
before promising it to the customer.

**Cites:**
- [Tech Your Chance — Android kiosk + device owner via ADB](https://www.techyourchance.com/android-kiosk-apps-and-in-house-mdms-using-device-owner/)
- [Cisco Meraki — Enabling Device Owner via ADB](https://documentation.meraki.com/Platform_Management/SM_-_Endpoint_Management/Install_and_Get_Started/Device_Enrollment/Enabling_Device_Owner_Mode_using_Android_Debug_Bridge_(ADB))

### 4.4 Why PlayService keeps respawning

PlayService is registered as a `<service>` with `android:persistent="true"`
**`[uncertain]`** plus a `BOOT_COMPLETED` receiver. Even when "disabled" via
ViPlex's UI, NovaStar's firmware update / config-pull jobs can re-enable it.
The bullet-proof path is one of:

- **A. Uninstall PlayService entirely.** Requires Device Owner or root. Risky
  — voids whatever support contract NovaStar offers and a firmware update
  may reinstall it.
- **B. `adb shell pm disable com.novastar.playservice`** (or whatever the
  package name is). Reversed by a factory reset but survives reboot.
- **C. Win the home-activity race + accept that PlayService can take over
  for a few seconds on a config-pull event.** This is what we have today
  on Goodview deployments and it's "good enough" for signage uptime.

---

## 5. Network specifics — directly relevant to the school-WiFi issue

The TB40 the operator sideloaded onto is reportedly stuck at "white screen
with retry button" — that's our APK's offline-banner state. Below is what
TaurusOS does on networking and the gotchas.

### 5.1 DNS

**No documented DNS lock.** TaurusOS uses DHCP-supplied DNS by default. The
school's NAT will hand out the school's resolver. We have no evidence
NovaStar pins DNS to their CDN — but we have no evidence they don't, either.
**Action item:** First-boot diagnostic should `nslookup` our API hostname
and our root CA's OCSP host, and surface the result in the offline banner so
operators can see "DNS for `api.educms.com` returned `NXDOMAIN`" instead of
just "no internet".

### 5.2 Captive portal handling

Android 11 has [native captive portal API](https://developer.android.com/about/versions/11/features/captive-portal)
that hits `connectivitycheck.gstatic.com` on connect, detects a 30x redirect
to a portal page, and surfaces a notification. **`[uncertain]` whether NovaStar
left this enabled** — the Settings UI to acknowledge captive portals is
hidden on Taurus (no notification shade), so even if Android detects it,
the operator can't interact with it.

**Practical implication:** A Taurus on school WiFi behind a captive portal
is essentially **unrecoverable from inside the device** until the network
admin whitelists its MAC. Three options for our APK:

1. **In-app captive portal probe.** On every connection failure, fetch
   `http://connectivitycheck.gstatic.com/generate_204`. If it returns 200
   with HTML instead of 204 with empty body, surface a "this network needs
   browser sign-in — please ask IT to whitelist this MAC" message in the
   banner with the device's MAC printed in 64pt font.
2. **In-app captive portal browser.** Embed a WebView in the offline banner
   that opens the captive portal page when detected. Risky — we'd be giving
   the kiosk a general-purpose browser, but better than bricking.
3. **Document MAC-whitelisting as a deployment prerequisite.** Cheapest.

We currently do none of the three. **Strongest single APK fix from this
research is to add (1).**

### 5.3 Phone hotspot gotchas on Rockchip A55

Phone hotspot common failure modes the operator may be hitting:

- **MTU mismatch.** Phone hotspots default to 1500 but cellular carriers
  enforce 1492 or 1480. Some Rockchip kernels don't path-MTU-discover
  cleanly and TLS handshakes time out. Workaround: in your APK,
  set `OkHttp` (or whatever HTTP client) to retry with smaller fragmented
  TLS records on first connect failure.
- **IPv6 issues on RK3xxx.** Older Rockchip kernels have known
  router-advertisement bugs that present as "DHCP works, can't reach
  anything off-LAN." Workaround: log `Build.HARDWARE` and force IPv4-only
  resolution if it matches a known-bad list.
- **Captive portal on phone hotspot.** Carriers like T-Mobile inject
  warnings on un-tethered devices — the SAME captive portal flow as §5.2
  fires. Same fix applies.

### 5.4 First-boot Ethernet behavior

NovaStar docs ([Novastar Wiki](https://novastar.wiki/en/screen-connection))
confirm: priority is **Wired > Wi-Fi STA > 4G**. Default Ethernet is DHCP.
Falls back to NOTHING if DHCP fails — there's no link-local APIPA. If the
school's network requires 802.1x port auth or MAC pre-registration, the
Taurus appears to have no network at all.

**Diagnostic checklist for "fresh TB40 black screen on school WiFi":**

1. Is the TB40 connected via Ethernet or Wi-Fi STA? (Check Wi-Fi AP from
   phone — if SSID `AP<last8>` is broadcasting, you can join it directly.)
2. From a phone connected to the AP, run ViPlex Handy → device should show
   up. If yes, network stack is fine and the problem is upstream.
3. Use ViPlex Handy's terminal control panel to set static IP / DNS or
   verify DHCP.
4. If captive portal: phone-hotspot the box, MAC-whitelist on the school
   network, swap back.

---

## 6. Community / industry coverage

Despite NovaStar's market leadership in LED-controllers, the third-party
sideload community is **smaller and less Reddit-active than for typical
Android sticks/STBs.** This research found no Reddit threads, no AVForums
threads, no XDA threads, and no Hacker News discussion specifically about
sideloading on Taurus boxes. The body of knowledge lives in:

| Source | What's there | Link |
|---|---|---|
| **OnSign** docs | Canonical 13-step novasoft sideload recipe + SPM Plugin (Rockchip) | [docs.onsign.com](https://docs.onsign.com/android/novastar-taurus-android) |
| **SmartPlayer** wiki | Same recipe with the `selftest` keystroke for ADB and the NovaLauncher gotcha | [wiki.smartplayer.org](https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en) |
| **Time Drops** integrator PDF | First-party "for our customers" install sheet | [time-drops.com/taurus.pdf](https://time-drops.com/taurus.pdf) |
| **DVS LED** support article | LED-screen-side configuration on ViPlex (not for sideload) | [support.dvsledsystems.com](https://support.dvsledsystems.com/hc/en-us/articles/19166480214932-Configure-an-LED-Screen-Media-Player-on-ViPlex-Software-NovaStar-Taurus-Series) |
| **Westan Australia** KB | Default credentials | [support.westan.com.au](https://support.westan.com.au/portal/en-gb/kb/articles/novastar-taurus-access) |
| **mctrlvp.com** | "Multimedia Player WebView Upgrade Guide" — referenced widely, source intermittently down | [mctrlvp.com](https://www.mctrlvp.com/multimedia-player-webview-upgrade-guide/) |
| **NovaStar OSS bucket** | Every official NovaStar PDF — quick-start, async mode, troubleshooting | [oss.novastar.tech](https://oss.novastar.tech/) |
| **Xibo community forum** | One thread on driving NovaStar signs from Xibo Windows player (no sideload) | [community.xibo.org.uk](https://community.xibo.org.uk/t/xibo-and-novastar-led-displays/5029) |

There is **no Reddit, no AVForums, no Hackaday post we found** documenting
this. The community is roughly 5-7 integrator companies plus NovaStar's own
PDFs. That's the entire surface area.

### 6.1 What the major signage CMSes officially support on Taurus

| CMS | Official Taurus support? | Notes |
|---|---|---|
| **OnSign** | YES — explicit | Documented sideload + Rockchip SPM Plugin path |
| **Xibo** | NO direct support; can drive NovaStar signs from a separate Windows/Android player | Not a sideload story |
| **Yodeck** | NO | Compatibility list: Yodeck Player, Raspberry Pi, BrightSign, Android, Tizen, webOS — Taurus not mentioned |
| **Rise Vision** | NO | Their player runs on PCs / their own OS / Chromebox |
| **OptiSigns** | NO direct mention; runs on generic Android boxes so might work with novasoft path | Untested |
| **ScreenCloud** | NO | |
| **BrightSign** | N/A — competing hardware | |
| **SmartPlayer** | YES — explicit | Same novasoft path as OnSign |

**Cites:**
- [Yodeck — supported hardware list (no NovaStar)](https://www.yodeck.com/docs/user-manual/what-hardware-players-does-yodeck-support-for-playback/)
- [OnSign — Taurus install page](https://docs.onsign.com/android/novastar-taurus-android)

OnSign and SmartPlayer are the two we should consider direct competitors
on this hardware path.

---

## 7. Common failure modes documented by others

Mapping operator-reported symptoms to likely causes from the research.

### 7.1 White screen with retry button (the operator's current state)

In the EDU CMS player, "white screen with retry" is our offline banner /
"can't reach API" state. On Taurus this can mean:

| Cause | Probability | Fix |
|---|---|---|
| Captive portal not signed in | HIGH on school WiFi | §5.2 in-app captive portal probe + MAC whitelist |
| DNS for `api.educms.com` failing | MEDIUM | log nslookup result in banner |
| TLS handshake failing on stale WebView | MEDIUM if WebView is factory | Trigger WebView upgrade; check cipher suites |
| Clock skew → JWT verification failing | MEDIUM | Force NTP sync at boot (we already do, but confirm route to `pool.ntp.org` isn't blocked) |
| HTTPS to non-NovaStar hosts blocked | LOW (we have no evidence of this) | Test: `curl -v https://www.google.com` from adb shell |
| MTU on phone hotspot | MEDIUM if hotspot used | Smaller TLS records / OkHttp retry |

### 7.2 PlayService respawning

Documented earlier (§4). Best fix: register our APK as CATEGORY_HOME and
disable PlayService via ViPlex.

### 7.3 WebView refusing to load (TLS / cipher mismatch)

Factory Taurus WebView is OLD. Signs it's the issue:
- HTTPS to most modern sites fails
- HTTP to the same hostname works
- Specifically: server requires TLS 1.2+ ECDHE-ECDSA, WebView speaks RSA-only
  cipher set

**Fix:** Push the operator through the WebView upgrade flow at
[mctrlvp.com](https://www.mctrlvp.com/multimedia-player-webview-upgrade-guide/).
Long-term: ship a bundled "modern WebView" inside our APK using
[GeckoView](https://mozilla.github.io/geckoview/) or
[Crosswalk](https://crosswalk-project.org/) — not free in APK size (+30 MB)
but eliminates the entire class of "stale system WebView" failures across
all our hardware (Goodview, Taurus, no-name sticks).

### 7.4 Touch input not working

**Most Taurus models are headless LED-controllers — they have NO display
output for the operator to interact with.** TB40 has HDMI 1.4 output that
mirrors the LED canvas at up to 1080p, intended for setup preview, not
touchscreen interaction. **Action item: don't ship anything in our UX that
requires touch on Taurus.** Configuration must be remote-only (dashboard
+ pairing-code flow we already have).

### 7.5 Display orientation / scaling

NovaStar's whole pitch is pixel-perfect 1:1 mapping from Android frame
buffer to LED diodes. Setting the canvas resolution in NovaLCT/ViPlex
configures the Android display size. **Our APK should NOT call
`Display.getRealSize()` and assume the result is a sane resolution** —
on a custom 800×3000 ribbon display, every assumption about 16:9 fails.
We already handle this via the `transform: scale()` template pattern, but
it's worth re-verifying for portrait LED canvases.

### 7.6 Audio output paths

TB40: 1× 3.5mm stereo, 48 kHz fixed sample rate. No HDMI audio confirmation.
TB30: 1× 3.5mm stereo. Other Taurus: assume audio output exists but require
external speaker. **Don't assume HDMI audio works** — and never assume an
LED-controller has an audio output at all without confirming the model.

### 7.7 Permission grants on TaurusOS

`REQUEST_INSTALL_PACKAGES` is granted automatically when ViPlex installs
the APK. For OTAs we need to be the package installer (`pm set-installer`)
or the user has to dismiss a system dialog every 6h. Section 4.3 (Device
Owner) is the only path to true silent OTA.

`SYSTEM_ALERT_WINDOW` for the offline banner overlay: works without
prompting on most TaurusOS images we've seen reports of, but Android 11
requires this to be granted via Settings UI which doesn't exist on Taurus.
**Pre-grant via `adb shell appops set ... allow` or rely on full-screen
activity instead of overlay.**

---

## 8. Summary diagnostic playbook for the operator's TB40

Mapping back to the brief's specific scenario:

1. **Confirm hardware identity.** From ViPlex's Terminal Control panel,
   read the device's serial number. Look up "is this an A55-era TB40 or
   an older RK3288 board" — A55 = current, ABI is `arm64-v8a`. Push the
   `arm64-v8a` APK; fall back to `universal` on `INSTALL_FAILED_NO_MATCHING_ABIS`.

2. **Confirm the install actually completed.** ViPlex's "User Software"
   list should show our package and version. If it does and the screen
   is still blank, the install worked and the issue is launch.

3. **PlayService disabled?** From ViPlex User Software, confirm
   PlayService is set to disabled. If not, disable it and reboot.

4. **Auto-launch checked?** Same panel — "Auto launch on startup" must
   be toggled on. Reboot.

5. **Network reachable from the box itself?** ViPlex Handy on a phone →
   join the box's `AP<last8>` SSID → Terminal Control → ping our API.

6. **Captive portal?** Phone-hotspot the box. If hotspotting it works,
   school WiFi is the issue (captive portal or MAC lock). MAC-whitelist
   with the school's IT.

7. **Clock?** Force NTP sync via Terminal Control / Time Synchronization
   Management. JWT verification fails if clock is off.

8. **WebView old?** Push the WebView upgrade APK from
   [mctrlvp.com](https://www.mctrlvp.com/multimedia-player-webview-upgrade-guide/)
   and reboot.

9. **Last resort: ADB.** Enable ADB via `novasoft + selftest`,
   `adb connect <ip>:5555`, `adb logcat` and read what our APK is
   actually crashing on.

---

## 9. Top 5 actionable fixes for our APK build (executive checklist)

1. **First-boot device-identity beacon.** Log `Build.MODEL`,
   `Build.SUPPORTED_ABIS`, `Build.VERSION.SDK_INT`, `Build.HARDWARE`,
   the WebView package version, and `Build.PRODUCT` to our API. After
   3-5 real Taurus deployments we have ground truth on what NovaStar
   ships and can stop guessing about ABI / Android version.

2. **In-app captive portal probe and "MAC whitelist needed" banner.**
   On every offline state, fetch `connectivitycheck.gstatic.com/generate_204`
   to detect captive portal and `nslookup` our API host to detect DNS
   failure. Surface the device's MAC + diagnostic on-screen at 64pt so
   operators can hand it to school IT.

3. **Register CATEGORY_HOME + document "disable PlayService" as a
   required ViPlex step.** This is the cheapest way to win the
   PlayService respawn race without Device Owner. Bake the requirement
   into our PLAYER_APK_NOVA_TAURUS.md (already mostly there) and add
   a runtime warning in the player UI if our APK is NOT the active
   home activity.

4. **Bundle a modern WebView (GeckoView or upgrade flow link).**
   Factory NovaStar WebView is old enough that TLS to modern servers
   can fail. Either bundle GeckoView (+~30 MB APK size, eliminates the
   entire failure class) or surface a one-click "upgrade WebView" link
   in our offline banner pointing at NovaStar's WebView Upgrade APK.

5. **Verify Device Owner provisioning works on a sacrificial Taurus.**
   `adb shell dpm set-device-owner com.educms.player/.AdminReceiver`.
   If it works (no "device already provisioned" error), we get
   silent OTAs, true kiosk lock, and the ability to disable
   PlayService programmatically. This is the single biggest reliability
   upgrade available and is currently theoretical for our deployment.

---

## 10. Sources (full list)

### Primary — NovaStar
- [NovaStar OSS PDF bucket](https://oss.novastar.tech/) — index of every official PDF
- [TB40 Specifications V1.2.1, Nov 2024](https://oss.novastar.tech/uploads/2024/11/TB40-Multimedia-Player-Specifications-V1.2.1.pdf)
- [TB30 Specifications V1.1.0, Jun 2024](https://oss.novastar.tech/uploads/2024/06/Taurus-Series-Multimedia-Player-TB30-Specifications-V1.1.0.pdf)
- [ViPlex Express Async Mode User Manual V3.0.0, Aug 2024](https://oss.novastar.tech/uploads/2024/08/ViPlex-Express-Async-Mode-User-Manual-V3.0.0.pdf)
- [ViPlex Express Async Mode User Manual V2.25.1, Dec 2023](https://oss.novastar.tech/uploads/2023/12/ViPlex-Express-Async-Mode-User-Manual-V2.25.1.pdf)
- [ViPlex Handy User Manual V5.1.0, Jun 2024](https://oss.novastar.tech/uploads/2024/06/ViPlex-Handy-User-Manual-V5.1.0.pdf)
- [Synchronous Playback Implementation Instructions V1.6.7](https://oss.novastar.tech/uploads/2022/09/Taurus-Series-Multimedia-Players-Synchronous-Playback-Implementation-Instructions-V1.6.7.pdf)
- [Taurus Common Problems & Remedies V1.3.2](https://rgb.center/upload/iblock/2f0/Taurus%20Series%20Multimedia%20Players%20Common%20Problems%20r%20Remedies-V1.3.2.pdf)

### Primary — Third-party integrators
- [OnSign — NovaStar Taurus Android install guide](https://docs.onsign.com/android/novastar-taurus-android)
- [SmartPlayer wiki — TB30 install (the canonical sideload recipe)](https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en)
- [Time Drops — Taurus install integrator PDF](https://time-drops.com/taurus.pdf)
- [DVS LED — Taurus + ViPlex configuration](https://support.dvsledsystems.com/hc/en-us/articles/19166480214932-Configure-an-LED-Screen-Media-Player-on-ViPlex-Software-NovaStar-Taurus-Series)
- [Westan Australia — Taurus access KB (default passwords)](https://support.westan.com.au/portal/en-gb/kb/articles/novastar-taurus-access)
- [LEDinCloud — TB40 deep dive](https://www.ledincloud.com/novastar-tb40/)
- [LEDinCloud — Taurus multimedia players overview](https://www.ledincloud.com/novastar-taurus-multimedia-players/)
- [LEDinCloud — Common LED media player passwords](https://www.ledincloud.com/led-media-player-software-login-passwords/)
- [LEDinCloud — ViPlex Express tutorial 2026](https://www.ledincloud.com/novastar-viplex-express/)
- [LED Screen Board — Multimedia Player Guide](https://www.ledscreenboard.com/novastar-multimedia-player-guide/)
- [Olympian LED — ViPlex Express download / 2.26.0](https://olympianled.com/product/novastar-viplex-express-software-download/)

### Hardware / SoC reference
- [Wikipedia — Rockchip](https://en.wikipedia.org/wiki/Rockchip)
- [Wikipedia — Rockchip RK3288](https://en.wikipedia.org/wiki/Rockchip_RK3288)
- [Wikipedia — ARM Cortex-A55](https://en.wikipedia.org/wiki/ARM_Cortex-A55)
- [Esper — RK3288 device specs](https://www.esper.io/devices/rockchip-rk3288)
- [CNX Software — RK3568 Android 11 announce](https://www.cnx-software.com/2021/02/10/geniatech-rk3568-development-board-to-support-android-11-and-linux/amp)

### Kiosk / Device Owner
- [Tech Your Chance — Android kiosk + device owner](https://www.techyourchance.com/android-kiosk-apps-and-in-house-mdms-using-device-owner/)
- [Cisco Meraki — Device Owner via ADB](https://documentation.meraki.com/Platform_Management/SM_-_Endpoint_Management/Install_and_Get_Started/Device_Enrollment/Enabling_Device_Owner_Mode_using_Android_Debug_Bridge_(ADB))
- [Hexnode — What is Android device owner mode](https://www.hexnode.com/blogs/what-is-android-device-owner-mode/)
- [Android Developers — Captive portal API support (Android 11)](https://developer.android.com/about/versions/11/features/captive-portal)
- [DEV Community — Android Kiosk Mode complete guide](https://dev.to/vantagemdm/android-kiosk-mode-the-ultimate-guide-to-locking-down-devices-140k)

### CMS competitive landscape
- [OnSign Taurus product page](https://www.onsign.com/novastar-taurus)
- [Yodeck — supported hardware](https://www.yodeck.com/docs/user-manual/what-hardware-players-does-yodeck-support-for-playback/)
- [Xibo community forum — NovaStar LED displays thread](https://community.xibo.org.uk/t/xibo-and-novastar-led-displays/5029)
