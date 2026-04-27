# EduCMS Manager APK — Provisioning Guide

> **Status (2026-04-27):** Phase 1 scaffold built but not yet
> deployed. This guide is the runbook we'll follow when we're ready
> to roll Manager onto live kiosks. See
> `scratch/manager-apk/01-architecture-decision.md` for the
> architectural rationale.

## What Manager does

Companion APK to the EduCMS Player. Three jobs:

1. **Silent OTA install** — once provisioned as `DEVICE_OWNER`,
   Android grants Manager the right to install Player APK upgrades
   without showing the system "Install / Cancel" prompt. Today's
   unattended kiosks stall on that prompt; Manager fixes it.
2. **Watchdog** — runs in a separate process from Player. If Player
   crashes hard (segfault, OOM, ANR-kill), Manager notices via a
   missed cross-app heartbeat and force-restarts MainActivity.
3. **Boot launcher** — kicks Player on boot via a redundant pathway
   (Player has its own BootReceiver too, so Manager's is a backup).

Manager has NO user interface. It's a daemon — runs as a foreground
service, no app drawer icon, no Settings entry except under "Device
admin apps" and "Apps" (where it shows up by package name only).

## Prerequisites

- Android 7+ device (same minSdk as Player)
- USB debugging enabled (Developer Options)
- ADB access to the device, even briefly
- Device has been **factory-reset** OR has never had any user
  account set up, AND no other DPM-managed setup has occurred.
  This is an Android requirement for `set-device-owner`, NOT
  something Manager imposes.

If the device already has a Google account, Knox setup, or any
other DPM-aware provisioning, you must factory-reset before going
through these steps. Once you set Manager as device owner, the
device is bound to it until factory-reset OR until you explicitly
remove it via `dpm remove-active-admin`.

## Install order — single-sideload UX (matches Yodeck)

The deployment flow is **ONE sideload trip** + **ONE ADB command**.
Manager auto-fetches and installs Player on first launch. Same UX
as Yodeck (one APK install → multiple apps appear in Settings)
without the wrapper-APK complexity.

For a fresh kiosk:

1. **Factory-reset the device** (or use an out-of-box one). Required
   for `set-device-owner` to succeed — Android refuses to set device
   owner once any user account or DPM-managed setup has happened.
2. **Sideload Manager APK** (`edu-cms-manager-v1.0.0.apk`). Skip
   any post-install "Open" prompt — Manager has no UI.
3. **Run the ADB provisioning command** (see below):
   ```
   adb shell dpm set-device-owner com.educms.manager/.AdminReceiver
   ```
4. **Wait ~30 seconds.** ManagerApp.onCreate detects Player isn't
   installed and fires the bootstrap OtaWorker. The worker:
   - Hits `/api/v1/player/update-check` with currentVc=0
   - Downloads the latest Player APK from GitHub Releases
   - Verifies SHA256
   - Installs Player silently via PackageInstaller (silent works
     because Manager is now DEVICE_OWNER)
5. **Pair Player from the dashboard** as normal.

That's it. From this point on, every Player OTA push from the
dashboard lands silently with no operator action at the kiosk.

### Verifying the bootstrap install

Watch via logcat:
```
adb logcat -s ManagerApp:I ManagerOtaWorker:I OtaInstaller:I
```

Expected sequence (~20-60 seconds):
```
ManagerApp:        ManagerApp.onCreate — starting watchdog + scheduling OTA worker
ManagerApp:        Player not installed yet — firing immediate bootstrap OTA
ManagerOtaWorker:  Manager OTA worker starting (deviceOwner=true)
ManagerOtaWorker:  Player not installed yet — treating as first-install bootstrap (vc=0)
ManagerOtaWorker:  current Player: 0.0.0 (vc=0) fp=android-XXX… BOOTSTRAP=true
ManagerOtaWorker:  ota-state → CHECKING
ManagerOtaWorker:  OTA update available: 1.0.13 (vc=13) — downloading
ManagerOtaWorker:  ota-state → DOWNLOADING (0%)
... (progress reports every 3s) ...
ManagerOtaWorker:  ota-state → DOWNLOADING (100%)
ManagerOtaWorker:  ota-state → VERIFYING
ManagerOtaWorker:  ota-state → INSTALLING
OtaInstaller:      OTA install starting — sessionId=N target=com.educms.player deviceOwner=true
OtaInstaller:      session committed (sessionId=N) — awaiting OtaInstallReceiver callback
OtaInstallReceiver: install result: status=SUCCESS
```

If `deviceOwner=false` shows up, the ADB provisioning step was
skipped or failed — re-run step 3.

### Watchdog-only test (no device-owner)

If you want to TEST the watchdog (not the silent-install part)
and don't want to factory-reset, install Manager normally and skip
step 3. Manager runs the watchdog without DEVICE_OWNER; only the
silent install requires it. Player still must be sideloaded
manually in this case (Manager will fall back to the system
"Install" prompt that an unattended kiosk can't tap through).

## ADB provisioning command

On a freshly-reset device with Manager installed:

```bash
adb shell dpm set-device-owner com.educms.manager/com.educms.manager.AdminReceiver
```

Expected output:

```
Success: Device owner set to package com.educms.manager
Active admin set to component {com.educms.manager/com.educms.manager.AdminReceiver}
```

Common error messages and what they mean:

| Error | Cause | Fix |
|---|---|---|
| `Not allowed to set the device owner because there are already several users on the device` | A user account exists | Factory-reset |
| `Not allowed to set the device owner because there are already some accounts on the device` | A Google account is set up | Factory-reset |
| `java.lang.IllegalStateException: Trying to set the device owner, but device owner is already set` | Manager (or another app) is already device owner | Run `adb shell dpm remove-active-admin com.educms.manager/.AdminReceiver` first, OR factory-reset |
| `cmd: Failure calling service device_policy: Failure from system` | Some OEM ROMs (rare) reject debug-signed device-owner provisioning | Use a release-signed Manager APK, OR use the OEM's own MDM provisioning path |

For the debug build, the package name is
`com.educms.manager.debug` (not `com.educms.manager`). The `applicationIdSuffix = ".debug"` in
`build.gradle.kts` adds the suffix. Adjust the command accordingly:

```bash
adb shell dpm set-device-owner com.educms.manager.debug/com.educms.manager.AdminReceiver
```

(The `AdminReceiver` class path stays in the base namespace; only
the application id gets the suffix.)

## Verifying provisioning

After the ADB command succeeds, on the device:

```bash
adb shell dumpsys device_policy | grep -A 2 "Device Owner"
```

Expected:

```
Device Owner:
    user=0
    name=com.educms.manager
```

In Manager's logs (`adb logcat -s AdminReceiver:I ManagerApp:I WatchdogService:I`):

```
AdminReceiver: AdminReceiver enabled — deviceOwner=true
ManagerApp:    ManagerApp.onCreate — starting watchdog
WatchdogService: WatchdogService.onCreate
WatchdogService: heartbeat fresh again (age=...) — clearing streak
```

Watching from the dashboard side, the kiosk's `last_ota_state`
column will start populating with real per-phase data on the next
OTA push (Manager owns that channel now).

## Removing Manager (uninstall)

Manager protects itself against trivial uninstall — once it's
device owner, the user can't drag it to the trash. To uninstall:

```bash
adb shell dpm remove-active-admin com.educms.manager/.AdminReceiver
adb uninstall com.educms.manager
```

The remove-active-admin step relinquishes the device-owner role.
After that, the package can be uninstalled normally. This won't
factory-reset the device or affect Player.

## Phase 3 preview: QR provisioning

Phase 1 is ADB-only because that's the simplest path. Phase 3 will
add a QR-code-driven first-boot wizard so customers can:

1. Plug the kiosk in for the first time
2. Open Android setup wizard, tap the standard "Set up your
   device for work" → "Scan QR code" path (Android's built-in
   `Provisioning` flow accepts a QR encoding the package name +
   download URL of Manager)
3. Walk away

Until Phase 3 ships, every kiosk needs the ADB step. For our
current fleet (M43 + The Den) that's two ADB sessions.

## Open issues to track

- **Same-key requirement.** Manager's `HEALTH_PERMISSION` is
  signature-protected, which means Player + Manager must be signed
  with the SAME key for cross-app IPC to work. We use the committed
  `app/debug.keystore` for both. If we ever introduce a release
  build flavor with a different key, we'd need to switch
  `HEALTH_PERMISSION` to a different protection level (probably a
  custom permission with manual user grant, or just public — at
  the cost of any third-party app being able to fake heartbeats).
- **ARM-only test fleet.** First two test kiosks (M43, The Den)
  are ARM. We haven't verified DPM provisioning on x86_64 emulator
  builds. Phase 1 deploy plan: do M43 and The Den, only.
- **Goodview / Taurus quirks.** OEM signage boards sometimes ship
  with their own DPM apps already provisioned, which would block
  Manager. Each board needs a check before the rollout: factory
  reset, then verify `dumpsys device_policy` shows no existing
  device owner.
