# Competitor NovaStar Taurus Deployment Playbooks

**Researched:** 2026-05-06
**Scope:** TB30, TB40, TB50, TB60 (Taurus series, Android 11, ARM 4-core A55 1.8 GHz, 1GB+32GB)
**Why this matters:** A pilot customer sideloaded our APK onto a fresh TB40 and got stuck at "black screen with mouse cursor" / "white screen with retry button." NovaStar officially says third-party apps are not supported. This document captures the playbook every shipping signage CMS uses to deploy on Taurus anyway.

---

## TL;DR — The "novasoft" Hidden Menu Is the Whole Game

There is a single, undocumented-in-public-NovaStar-manuals workflow that every working signage CMS uses on Taurus. It is:

1. Connect a Windows PC to the same LAN as the Taurus.
2. Open **ViPlex Express** (the NovaStar PC tool).
3. **Type the literal string `novasoft` blind into the home screen** (no input box appears — you just type and a hidden "User Software" menu materializes).
4. Click "User Software", connect to the device (default `admin` / `123456`).
5. **Disable the "PlayService" toggle** (this kills NovaStar's built-in player so it stops fighting your APK for the foreground).
6. Browse to the APK, **check "Auto launch on startup"** AND **check "Automatically run after installation"**, click Install.
7. Click "Restart Now" — your APK comes up on next boot.

For ADB access (needed for OTA, debugging, and Device-Owner provisioning) you also type `Selftest` in the same blind way to expose a "Debug mode" panel where you flip ADB to ON. Then `adb connect <device_ip>` works over the LAN.

This is exactly what OnSign, SmartPlayer, Navori (pre-Aug-2025), and the working Xibo deployments document. Yodeck, Rise Vision, and ScreenCloud do not document Taurus support at all.

---

## Per-CMS Findings

### 1. OnSign TV / signageOS — Most Mature Playbook

**Status:** Officially supported. Lists TB30/TB40/TB50/TB60 explicitly with pixel-cap specs.
**Architecture:** OnSign Player APK + a separate "SPM" (Signage Platform Module) APK. The Rockchip-flavored SPM is what unlocks remote-reboot / remote-view / scheduled-reboot / device-serial.
**Install flow:** Identical to the canonical novasoft flow above. They ship `OnSign Player.apk` plus `SPM-Rockchip.apk` and the install instructions explicitly say to disable PlayService, tick both auto-launch boxes, and reboot.
**OTA:** OnSign has its own remote-update channel built into the SPM. No reliance on NovaStar's update path.
**Device Owner:** Their separate `SPM DPC` package (`module.platform.signage/.AdminReceiver`) is set as Device Owner via `adb shell dpm set-device-owner` when stronger control is needed. **Requires factory-reset and "do not enter a Google account" before provisioning.** This is a hard prerequisite — if a Google account exists on the device, `dpm set-device-owner` fails with "not allowed; either an account or profile is on this device".
**Network:** Standard outbound HTTPS to OnSign cloud. No documented domain whitelist gotchas.
**Limitations they call out:** Need to use ViPlex Express (Windows-only) for the install. Can't be done from Mac/Linux without a Windows VM.

**Source:** docs.onsign.com/android/novastar-taurus-android, docs.onsign.com/signage-platform-module-spm, docs.onsign.com/en_US/spm-dpc-installation

### 2. SmartPlayer — Most Detailed Public Writeup (best read for our purposes)

**Status:** Officially supported on TB30 (and by extension the rest of the Taurus line).
**Critical extras vs the canonical flow:**
- **Firmware update is mandatory first.** "Failure to update the firmware on the device will prevent proper content playback!" They ship a `.nuzip` file and use ViPlex Express → Control → Player upgrade → Local Upgrade. This is likely why our customer's TB40 is dead at white-screen — fresh-from-factory firmware is too old.
- They explicitly call out: **"Set NovaLauncher as default application" or ViPlex will not function properly.** Translation: do NOT replace the Nova system launcher with your own. Co-exist with it.
- After install they activate via "Terminal Control → Playback Management" — this is a discrete second step beyond just installing.
- ADB unlock is a two-string sequence: type `novasoft`, then type `Selftest`, then a Debug-mode panel appears. Toggle ADB ON (slider goes green). Then right-click the device → "debug tool" to start a session.
- Maximum content resolution on TB30 is documented as 960×750 (~650K pixels). They recommend 208×312 for smooth playback. **TB40/TB50/TB60 have higher caps** but the principle holds: the Android UI lags hard at the device's max LED-pixel-count.
- Network/time MUST be configured BEFORE schedule-driven content will work. This is a common silent failure.

**Source:** wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en

### 3. Navori — Cleanest Long-Term Story

**Status:** Officially supported on TB30/TB50/TB60.
**Pre-August 2025:** Required a NovaStar-supplied custom firmware to make the Navori APK work. Customers had to coordinate with NovaStar support to get the right build.
**Post-August 2025:** Native APK support landed in stock NovaStar firmware. Now uses NovaStar's standard firmware-upgrade process — no custom builds needed.
**Takeaway:** This is the smoking gun confirming **NovaStar is upstreaming third-party-app support into the standard firmware as of late 2025**. If our customer's TB40 has firmware older than that release, they need to update before anything will work cleanly.
**Source:** navori.com/app/novastar/

### 4. Xibo (Open Source) — Most Public Failure Modes Documented

**Status:** Not officially supported. Multiple community success-and-failure threads.
**TB3 (older Taurus):** Reported as essentially impossible. "Very tight android rom, I couldn't find a way to side load the apk." — community.xibo.org.uk/t/novastar-taurus-tb3/24785
**TB60 (Android 11) — version 2.217:** Crashed immediately with `Fatal signal 7 (SIGBUS), code 1 (BUS_ADRALN), fault addr 0x6e676977 in tid 1159 (RenderThread)`. Backtrace pointed at `android.view.SurfaceControl$Transaction.reparent` — Android-11 SurfaceView regression in the older Xibo build.
**TB60 (Android 11) — version 4.x:** Works stable on both TB50 and TB60. **Root cause was an Xibo bug in the SurfaceView lifecycle, not a NovaStar incompatibility.** Lesson: minimum supported Android version + WebView rendering path matters more than the device.
**Install method when it works:** Same novasoft flow via ViPlex Express. Author of the working thread explicitly tells future readers: "use Viplex (Windows software) to connect to the device, type novasoft to access the install menu, install APK and set auto-launch."
**Critical detail — they did NOT make Xibo the launcher.** "I needed to retain Nova services, so I installed Xibo without setting it as the launcher." Co-existing with NovaLauncher is the working approach.
**Source:** community.xibo.org.uk/t/novastar-tb60-with-xibo-apk-app-crashes/27938 + .../nova-tb60-with-xibo/27922

### 5. Yodeck — Does Not Support

**Status:** No NovaStar Taurus model on their tested-and-approved Android list. The list contains Chromecast, Android TV, Sony Bravia, Philips, generic Rockchip RK3399 boxes — but no Taurus.
**Why:** Yodeck's stated supported Android range is **Android 5 through Android 7**, and they push customers toward Raspberry Pi instead. Their Android offering is essentially de-emphasized.
**Implication:** They don't have a Taurus playbook. If a Yodeck customer runs Taurus they're on their own.
**Source:** yodeck.com/docs/user-manual/tested-and-approved-android-devices/

### 6. Rise Vision — Does Not Support

**Status:** No documented Taurus support. Rise Vision is web-based / Chrome OS-first; their Android player is a secondary product and they don't list Taurus.
**Source:** Negative result — no Rise Vision documentation on Taurus surfaced in any search.

### 7. ScreenCloud — Does Not Support

**Status:** No documented Taurus support. ScreenCloud's Android player runs on Android 10+ and they don't list any Taurus model. No KB article, no community thread.
**Source:** Negative result.

### 8. OptiSigns — Does Not Document Taurus

**Status:** OptiSigns supports Android 10+ generally, with Android 12+ recommended for kiosk mode + Play Integrity. Taurus is on Android 11 so it's technically in range, but **OptiSigns ships its own pre-built Amlogic-based player and doesn't certify NovaStar hardware specifically.** Customers attempting Taurus would follow the generic "install OptiSigns APK on Android" KB. No special tooling.
**Source:** support.optisigns.com (Android Player KB)

### 9. NoviSign — Does Not Document Taurus

**Status:** Generic Android APK install instructions. No Taurus-specific KB. NoviSign tells users to install the APK and "allow installation from unknown sources" — which doesn't work on a tight ROM like Taurus where `Settings` is locked behind ViPlex.
**Source:** novisign.com/help-center/player-apps/android/installation-user-guide/

### 10. Korbyt / FourWinds / Reach Media Network / Skykit / Mvix — No Documented Support

**Status:** None of these list Taurus. Mvix's official compatibility statement: "Android 8.0 or newer" generally — they don't certify NovaStar. Korbyt and FourWinds are enterprise-targeted and don't document the Taurus install flow publicly.
**Source:** Negative results across the board.

### 11. NovaStar's Own VNNOX (the platform we coexist with)

**Architecture:** VNNOX is a cloud platform that talks to two things: VPlayer (Windows/Linux PC software) and the **PlayService** APK on Taurus controllers.
**Protocols:** Per the limited docs that surfaced — proprietary over TCP. Reverse-engineered by `sarakusha/novastar` on GitHub (TypeScript wrapper, decompiled .NET libs, default ports **TCP 5200 / 5201 / 5203**). The Wireshark dissector in that repo confirms the wire format.
**SDK:** A real Taurus SDK exists for C/C++/C#/Java across Windows/Linux/Android/Mac/iOS — for player-control upper-computer software. NovaStar gates SDK access behind partnership.
**LAN binding:** ViPlex Handy / ViPlex Express discover Taurus over UDP, then talk over the proprietary TCP protocol on 5200-5203.
**Cloud binding:** Taurus binds to VNNOX via outbound HTTPS to NovaStar's cloud (no published port whitelist; standard 443).
**SNMP support:** VNNOX exposes SNMP for monitoring. Useful telemetry surface for our monitoring later.
**Important:** VPlayer and ViPlex Express MUST be on the same PC or same LAN to talk to each other. Different subnets break LAN management.
**GitHub:** github.com/sarakusha/novastar (open-source RE), github.com/silotrd/taurus-sdk-java (looks like an unrelated project — different "Taurus", payments-related — IGNORE)

---

## Cross-Cutting Patterns (What Everyone Does)

| Pattern | OnSign | SmartPlayer | Navori | Xibo | EduCMS today? |
|---|---|---|---|---|---|
| **Use ViPlex Express + `novasoft` to install** | YES | YES | YES (pre-Aug-2025) | YES | NO — we're trying ADB sideload |
| **Disable PlayService toggle** | YES | YES | YES | YES | NO |
| **Both auto-launch checkboxes** | YES | YES | YES | YES | NO |
| **Co-exist with NovaLauncher (do NOT replace)** | YES | YES | YES | YES (verified) | unclear |
| **Update firmware FIRST** | recommended | required | required (pre-Aug-25) | implied | NO |
| **Type `Selftest` for ADB unlock** | YES | YES | n/a | YES | NO |
| **Separate APK for elevated capabilities (SPM/DPC)** | YES | n/a | n/a | NO | yes (Manager/Player) |
| **Device Owner via `dpm set-device-owner`** | optional (DPC) | NO | NO | NO | not yet |
| **Test on `Android 11 + Rockchip A55`** | YES | YES | YES | YES (after fix) | unverified |

### Patterns that hold across every successful deployment

1. **No one bypasses ViPlex Express.** Even Xibo community veterans use it. Trying to "just enable Unknown Sources" on Taurus does not work — Settings is locked behind PlayService and ViPlex is the official back door. ADB-only installs (without first using ViPlex to disable PlayService) will work for the install but PlayService respawns and steals the foreground.
2. **PlayService is the foreground-fight problem.** It's NovaStar's built-in player. If you don't disable it via ViPlex, your APK launches and PlayService comes back over the top. White screens, black screens, intermittent flicker — all consistent with PlayService racing your app for the foreground.
3. **Firmware-first is non-negotiable.** SmartPlayer, Navori, and several integrator blogs all say update firmware before anything else. The shipping default firmware on a TB40 from a year-old SKU is often too old to host a modern WebView 60+ APK reliably. **This is the most likely root cause of our customer's "black screen / white screen" bug.**
4. **Co-exist with NovaLauncher; don't replace it.** SmartPlayer says explicitly: "Set NovaLauncher as default application or ViPlex will not function properly." Xibo's working deployment confirmed: do not set Xibo as launcher. Only the OnSign DPC route (full Device Owner provisioning after factory reset) should attempt launcher replacement, and even then NovaLauncher's services run in parallel.
5. **WebView rendering on Android 11 + Rockchip A55 is fragile.** The Xibo SIGBUS crash on TB60 in the RenderThread was an Android-11-specific SurfaceView regression. It went away on a newer Xibo build. Lesson: keep WebView call-paths simple, avoid complex SurfaceView reparenting, test on real Taurus hardware before claiming support.

### Patterns nobody uses (and why they fail)

- **Sideload via USB stick + Files app.** Locked launcher; no Files app accessible to the operator. Dead end on stock Taurus.
- **ADB install over USB OTG.** TB40 has no exposed USB-debug port pre-configured. You must enable ADB via the `Selftest` blind-typing trick first. So you can't do ADB-first; you have to ViPlex-first.
- **Replace the launcher entirely.** Breaks ViPlex management. Loses NovaStar's LED-output config tool. Kills any future firmware OTA capability.
- **Bypass ViPlex with a custom installer APK.** Has to be installed somehow — chicken-and-egg.
- **Yodeck's "any Android device" approach.** They tested generic Rockchip boxes but not Taurus. Their flow assumes a normal Android Settings app the user can open, which Taurus does not expose.

---

## Failure Modes — What Goes Wrong and How Survivors Fix It

| Symptom | Root Cause | Fix |
|---|---|---|
| Black screen with mouse cursor on first boot after sideload | PlayService is running and your APK was ADB-installed without disabling PlayService. PlayService claims the foreground; your app dies behind it. | Use ViPlex Express + `novasoft` flow. Disable PlayService toggle. Reboot. |
| White screen with "Retry" button | Your APK launched, but WebView could not load the start URL. Either firmware-shipped Android System WebView is too old for your bundle, or network isn't up yet at boot, or the kiosk URL is unreachable. | (a) Update firmware first. (b) Confirm network is connected via ViPlex. (c) Add a 10-second retry-with-cache fallback in the WebView shell so it doesn't hard-fail on a transient DNS miss at boot. |
| App crashes immediately with `Fatal signal 7 (SIGBUS) in RenderThread` | Android 11 + ARM 32-bit + SurfaceView reparenting bug. Hit by Xibo 2.217. | Bump WebView/Android-X libs; avoid manual SurfaceView reparenting; test on real Taurus hardware. |
| App installs and runs but PlayService keeps coming back over the top | You installed via ADB but didn't disable PlayService. | Connect via ViPlex, toggle PlayService off, restart. |
| App auto-launches first boot but not subsequent reboots | Forgot to check "Auto launch on startup" in ViPlex. The "Automatically run after installation" checkbox is one-time; the auto-launch checkbox is persistent. | Re-enter ViPlex User Software panel, tick "Auto launch on startup", apply. |
| Manager/Player permission prompt loop (relevant to our architecture) | A Manager APK trying to install/update Player APK without elevated install rights. On stock Taurus there's no way to grant `INSTALL_PACKAGES` to a regular APK. | Either (a) bundle Manager+Player as a single APK, (b) ship a Device Owner APK provisioned via `dpm set-device-owner` after factory reset (no Google account allowed), or (c) ship a system-app variant signed with the platform key (requires NovaStar partnership). |
| OTA APK update fails silently | Stock Android requires user-tap to install an APK. No `INSTALL_PACKAGES` permission for normal apps. | Same as above — ship Device Owner, or use NovaStar's own OTA channel via VNNOX (requires their cloud and signing). |
| LAN-management broken after install | The new launcher took over and ViPlex can no longer "see" the device. | Don't replace NovaLauncher. Co-exist. |
| IPv6-only carrier breaks cloud connection | Default Android System WebView prefers IPv6; if cloud is IPv4-only, dual-stack works but pure IPv6 breaks. (No Taurus-specific docs found, but generic Android players hit this.) | Force IPv4 in the WebView via DNS-resolution fallback, or ensure cloud has dual-stack. |
| Old TB3 won't sideload anything | The pre-Taurus-TB30 generation was too locked-down. | Upgrade hardware. TB30 and newer have the `novasoft` workflow. TB3 doesn't. |

---

## Specific Lessons for EduCMS Player APK on Taurus

Given the customer's symptoms ("black screen with mouse cursor" → "white screen with retry button"):

### Hypothesis 1 (most likely): Firmware too old
- TB40 firmware older than mid-2024 has WebView 60-80 baked in, which our Player APK with `androidx.webkit` constraints cannot run cleanly.
- **Action:** Have the operator open ViPlex Express, go to Control → Player upgrade → Local Upgrade, and apply the latest TB40 firmware (`.nuzip`) from novastar.com/downloads.

### Hypothesis 2: PlayService is fighting our Player for the foreground
- They likely sideloaded the APK via ADB or USB without disabling PlayService.
- **Action:** Use ViPlex Express + `novasoft` flow. Disable PlayService toggle. Reinstall our APK with both auto-launch checkboxes ticked. Reboot.

### Hypothesis 3: Network not up at app launch, WebView times out → retry button
- If our Player tries to load the kiosk URL before WiFi is associated, WebView shows the network-error page.
- **Action:** Add a 10-second retry-with-exponential-backoff in the Kotlin shell before rendering the failure UI. Cache the last known-good kiosk page locally and serve from cache while we retry the network.

### Hypothesis 4: Manager/Player architecture misfires on Taurus
- Our Manager-installs-Player flow needs `INSTALL_PACKAGES` privilege. Stock Taurus doesn't grant that.
- **Action:** Either consolidate Manager + Player into a single APK for Taurus deployments, or invest in a Device-Owner-provisioned Manager that can silent-install. The latter requires factory-reset + `dpm set-device-owner` and rules out Google-account-bound devices — but the Taurus has no Google account so this is feasible.

### What we should adopt (the OnSign / SmartPlayer playbook)

1. Document the "ViPlex Express → `novasoft` → disable PlayService → tick both checkboxes → reboot" install flow in our customer-facing onboarding for any LED-controller deployment.
2. Build a `firmware update first` warning into our pairing UX. Detect Taurus via User-Agent / device fingerprint and show "Please update your TB40 firmware via ViPlex Express → Control → Player upgrade before continuing."
3. Test the Player APK on real TB30/TB40/TB50/TB60 hardware (not emulator). The Android-11 + ARM-32 SurfaceView path is real and bites.
4. Ship the Manager APK as a Device-Owner-provisioned package for advanced deployments (no Google account required path on Taurus, so factory-reset is cheap). Use OnSign's `dpm set-device-owner` pattern.
5. Co-exist with NovaLauncher. Do not try to replace it. Our APK stays foreground because PlayService is OFF, not because our launcher is set as Home.

### What we should avoid

1. ADB-only sideload as the primary install path. It works for one-off engineer-driven setups but always breaks for non-technical operators who can't get past PlayService respawn.
2. Bundling our own WebView. Increases APK size 30+ MB, fights system updates, and the Rockchip A55 SoC barely has the RAM (1GB).
3. Replacing NovaLauncher. Breaks ViPlex management, breaks NovaStar's LED-output configuration tool, breaks future firmware OTAs.

---

## Sources

- **OnSign Taurus install:** https://docs.onsign.com/android/novastar-taurus-android
- **OnSign Taurus product page:** https://www.onsign.com/novastar-taurus
- **OnSign SPM overview:** https://docs.onsign.com/signage-platform-module-spm
- **OnSign SPM DPC (Device Owner):** https://docs.onsign.com/en_US/spm-dpc-installation
- **SmartPlayer detailed install on TB30:** https://wiki.smartplayer.org/index.php/Novastar_TB30_-_How_to_install_SmartPlayer_application/en
- **Navori native APK timeline (Aug 2025):** https://navori.com/app/novastar/
- **Xibo TB60 SIGBUS resolution thread:** https://community.xibo.org.uk/t/nova-tb60-with-xibo/27922
- **Xibo TB60 crash report thread:** https://community.xibo.org.uk/t/novastar-tb60-with-xibo-apk-app-crashes/27938
- **Xibo TB3 cannot sideload:** https://community.xibo.org.uk/t/novastar-taurus-tb3/24785
- **Time Drops install guide PDF:** https://time-drops.com/taurus.pdf
- **NovaStar Taurus user guide:** https://www.xpolight.com/files/Taurus-Series-Multimedia-Player-User-Guide.pdf
- **NovaStar TB40 spec sheet:** https://oss.novastar.tech/uploads/2024/11/TB40-Multimedia-Player-Specifications-V1.2.1.pdf
- **NovaStar Common Problems & Remedies PDF:** https://rgb.center/upload/iblock/2f0/Taurus%20Series%20Multimedia%20Players%20Common%20Problems%20r%20Remedies-V1.3.2.pdf
- **VNNOX cloud platform overview:** https://www.ledincloud.com/novastar-vnnox/
- **Taurus SDK reference (NovaStar VNNOX docs):** http://docs.vnnox.com/display/VNNOXEN/6.4+Taurus+SDK
- **GitHub — sarakusha/novastar (RE'd JS lib, ports 5200/5201/5203):** https://github.com/sarakusha/novastar
- **ViPlex Express (LedInCloud writeup with novasoft trick):** https://www.ledincloud.com/novastar-viplex-express/
- **Yodeck approved Android list (Taurus NOT listed):** https://www.yodeck.com/docs/user-manual/tested-and-approved-android-devices/
- **OptiSigns Android Player support:** https://help.optisigns.com/en/kb/optisigns-android-player
- **OptiSigns hardware support matrix:** https://support.optisigns.com/hc/en-us/articles/360021855653
- **Android Device Owner provisioning reference:** https://source.android.com/docs/devices/admin/provision

---

*End of report. Last updated 2026-05-06.*
