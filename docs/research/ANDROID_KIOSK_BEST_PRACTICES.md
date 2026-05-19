# Android Kiosk / Digital Signage — State-of-the-art Reference

**Audience:** EDU CMS Player APK maintainers (and any Kotlin / NestJS engineer
deploying signage to NovaStar Taurus, Goodview, TCL, Rockchip-based
locked-down ROMs).

**Purpose:** Catalogue every technique the Android signage industry uses to
get reliable kiosk behaviour out of vendor-locked AOSP-stripped devices,
with citations and code snippets. Read top-to-bottom once; thereafter use
the table of contents to jump.

**Last updated:** 2026-05-06.

---

## Table of contents

1. [Device Owner / Profile Owner provisioning](#1-device-owner--profile-owner-provisioning)
2. [REQUEST_INSTALL_PACKAGES and the per-app permission gauntlet](#2-request_install_packages-and-the-per-app-permission-gauntlet)
3. [Silent install on Android 12+ (USER_ACTION_NOT_REQUIRED)](#3-silent-install-on-android-12-user_action_not_required)
4. [CATEGORY_HOME / launcher replacement strategies](#4-category_home--launcher-replacement-strategies)
5. [Lock Task Mode (kiosk pinning) specifics](#5-lock-task-mode-kiosk-pinning-specifics)
6. [Foreground service patterns for keep-alive](#6-foreground-service-patterns-for-keep-alive)
7. [WebView compatibility on old Chromium](#7-webview-compatibility-on-old-chromium)
8. [OTA update strategies that actually work without DEVICE_OWNER](#8-ota-update-strategies-that-actually-work-without-device_owner)
9. [Network bootstrapping on no-GMS devices](#9-network-bootstrapping-on-no-gms-devices)
10. [Patterns from the digital-signage / EMM industry](#10-patterns-from-the-digital-signage--emm-industry)
11. [What this means for the EduCMS Player APK](#11-what-this-means-for-the-educms-player-apk)
12. [Sources](#sources)

---

## 1. Device Owner / Profile Owner provisioning

### 1.1 The five provisioning paths

There are five established ways to promote a DPC (Device Policy Controller) to
**Device Owner** (DO). Each requires a freshly factory-reset, never-signed-in
device — Android refuses `setDeviceOwnerApp` on a device with any user
account configured (this is intentional; it's the security boundary that
makes DO meaningful).

| Method | Min API | GMS required? | Locked-down OEM ROMs |
|---|---|---|---|
| **NFC bump** (DPC bundled in NFC payload) | 21 | No | Works if NFC hardware present (rare on signage) |
| **QR-code provisioning** (six-tap on welcome screen, scan QR) | 24 | **Yes** (the six-tap UI lives in `Setup Wizard`, which is GMS) | **Often broken** on AOSP-stripped builds |
| **Zero-touch enrollment** (manufacturer pre-registers serial in Google portal) | 26 | Yes (entirely Google-driven) | Not available without authorised reseller |
| **`adb shell dpm set-device-owner`** | 21 | No | **Works on every AOSP build** if `adb` is reachable |
| **Custom DPC autopilot** (a self-developed DPC that calls private system APIs on a privileged build) | 21 | No | OEM-bespoke; Esper Foundation OS is the canonical example |

For TaurusOS / Goodview / TCL signage boards: the only reliable path today
is the ADB one. QR provisioning is gated behind GMS Setup Wizard, which is
exactly what those builds strip out.

### 1.2 Exact ADB command

```
adb shell dpm set-device-owner com.educms.manager/.AdminReceiver
```

Sources: [AOSP testing-setup](https://source.android.com/docs/devices/admin/testing-setup),
[42Gears tech blog](https://techblogs.42gears.com/using-adb-for-speeding-up-the-device-owner-enrollment/),
[Florent Dupont — Android shell dpm](http://florent-dupont.blogspot.com/2015/01/android-shell-command-dpm-device-policy.html).

Pre-conditions:

1. **Factory-reset device.** Or a device that has been booted but no Google
   account or local user account has been added. The ADB pathway tolerates
   "first user but no accounts"; the API-only pathway does not.
2. **`adb` reachable.** USB or `adb tcpip 5555`. NovaStar boards ship `adbd`
   on by default in development mode (and operators frequently leave it on
   in production).
3. **Component name exists.** The package targeted in `set-device-owner`
   must declare a `BIND_DEVICE_ADMIN` receiver with a `device_admin.xml`
   meta-data file referencing the policies you'll use.

If you see `java.lang.IllegalStateException: Unable to set device owner`,
the device already has a Google account or another DO. Factory reset and
retry. Sources: [Android Enterprise community thread](https://www.androidenterprise.community/discussions/conversations/device-owner-provisioning/12237),
[XDA forum SOLVED thread](https://xdaforums.com/t/unable-to-set-device-owner-solved.4513841/).

### 1.3 The QR-code payload (for tomorrow when QR works)

Even though it doesn't work on stripped TaurusOS today, document the schema —
NovaStar and Goodview will eventually ship GMS-equivalent setup wizards.

```json
{
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_COMPONENT_NAME":
      "com.educms.manager/.AdminReceiver",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_SIGNATURE_CHECKSUM":
      "<base64 SHA-256 of signing cert>",
  "android.app.extra.PROVISIONING_DEVICE_ADMIN_PACKAGE_DOWNLOAD_LOCATION":
      "https://venue-os.app/download/manager.apk",
  "android.app.extra.PROVISIONING_WIFI_SSID": "SchoolWifi",
  "android.app.extra.PROVISIONING_WIFI_PASSWORD": "...",
  "android.app.extra.PROVISIONING_SKIP_ENCRYPTION": true,
  "android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE": {
    "tenantId": "...",
    "serverUrl": "https://venue-os.app"
  }
}
```

Sources: [Android Management API provisioning](https://developers.google.com/android/management/provision-device),
[Samsung Knox QR DO doc](https://docs.samsungknox.com/dev/knox-sdk/kbas/how-to-create-a-qr-code-to-enroll-a-device-into-android-enterprise-device-owner-do-mode/),
[Hexnode QR enrollment](https://www.hexnode.com/mobile-device-management/help/how-to-enroll-devices-in-android-enterprise-using-qr-code/).

### 1.4 What you gain with Device Owner

Once your DPC (in our case Manager) is DO, the system grants it a privilege
escalation that's effectively root-equivalent for app management:

- **`PackageInstaller.commit()` is silent.** No "Install / Cancel" prompt.
  Source: [PackageInstaller — Microsoft Learn mirror](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller).
- **`startLockTask()` does not show the screen-pinning user dialog.**
  Source: [Lock task mode docs](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode).
- **`setLockTaskPackages([...])` is callable.** Only DO and affiliated
  POs can call this. Same source.
- **`setLockTaskFeatures(int)` is callable** (Android 9+) — lets you toggle
  status bar, navigation, system info, keyguard, global actions per
  feature. Same source.
- **`enableSystemApp()` / `setApplicationHidden()`** — silently install a
  pre-bundled system APK or hide the OEM launcher icon.
- **`setStatusBarDisabled(true)`** — kill the status bar at the framework
  level (not just Immersive Mode hidden — actually unresponsive to drag).
- **`installKeySetAsUser()`, `setUserRestrictions(...)`** — block USB debugging,
  factory reset, account creation, app installation from unknown sources, etc.
- **`reboot()`** — programmatic reboot with no UI.
- **CA cert install** without user consent (rarely needed for signage).

### 1.5 The DevicePolicyManager methods that matter for kiosks (2024-2026)

| API | Purpose |
|---|---|
| `setLockTaskPackages(ComponentName, String[])` | Allowlist for `startLockTask` — required even when not pinning |
| `setLockTaskFeatures(ComponentName, int)` | Bitfield: `LOCK_TASK_FEATURE_HOME` `_OVERVIEW` `_GLOBAL_ACTIONS` `_NOTIFICATIONS` `_SYSTEM_INFO` `_KEYGUARD` `_NONE` |
| `addPersistentPreferredActivity(...)` | Hardwire our app as the handler for `CATEGORY_HOME` (system ignores user choice) |
| `setKeepUninstalledPackages(...)` | Stop OEM bloat from coming back after you uninstall |
| `setApplicationRestrictions(...)` | Push a managed-config Bundle into our own app — replaces baked-in env vars |
| `setStatusBarDisabled(boolean)` | True kill of status bar (DO-only) |
| `reboot(ComponentName)` | Programmatic reboot |
| `wipeData(int)` | Factory reset (used as last-resort recovery in some kiosks) |
| `setAutoTimeRequired(true)` | Force NTP-only clock; see §9 |
| `setSystemUpdatePolicy(SystemUpdatePolicy.createWindowedInstallPolicy(...))` | Schedule OEM OTAs to off-hours so the screen doesn't reboot mid-bell |
| `setGlobalSetting(Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7")` | Keep screen on whenever powered (signage must) |
| `setKeyguardDisabled(true)` | No lockscreen on boot |
| `setUserRestriction(UserManager.DISALLOW_FACTORY_RESET)` | Operator can't accidentally wipe |
| `setUninstallBlocked(...)` | Stop someone from uninstalling Player or Manager |

Sources: [DevicePolicyManager reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager),
[Lock task mode docs](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode),
[Ezurio kiosk reference](https://www.ezurio.com/documentation/introduction-to-android-lock-task-mode-kiosk-mode).

### 1.6 Open-source DPC samples

- **TestDPC** (Google) — canonical reference. https://github.com/googlesamples/android-testdpc
- **Sample-Device-Owner-android-app** by bayuwijdev — minimal Kotlin Kiosk DPC.
  https://github.com/bayuwijdev/Sample-Device-Owner-android-app
- **mrugacz95/kiosk** — older but well-documented. https://github.com/mrugacz95/kiosk

---

## 2. REQUEST_INSTALL_PACKAGES and the per-app permission gauntlet

### 2.1 What changed at API 26 (Android 8.0)

Pre-O, Android had a single global "Allow installation of apps from
unknown sources" toggle. Anyone with `INSTALL_PACKAGES` could pull the
trigger on `Intent.ACTION_INSTALL_PACKAGE`.

Starting in O (API 26), Google moved the toggle **per-installer-app**:
each app that wants to install another package must separately be granted
"Install unknown apps" by the user. Apps targeting API 26+ must hold
`REQUEST_INSTALL_PACKAGES` in their manifest. Trigger the prompt with:

```kotlin
val intent = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES)
    .setData("package:${context.packageName}".toUri())
context.startActivity(intent)
// Then check PackageManager.canRequestPackageInstalls()
```

Source: [Android Developers blog "Making it safer to get apps on Android O"](https://android-developers.googleblog.com/2017/08/making-it-safer-to-get-apps-on-android-o.html),
[Play policy on REQUEST_INSTALL_PACKAGES](https://support.google.com/googleplay/android-developer/answer/12085295?hl=en).

### 2.2 The policy floor — what Play allows

Google's Play policy explicitly restricts `REQUEST_INSTALL_PACKAGES` to:

- Web browsers
- File managers
- Enterprise device-management apps
- App stores

Source: [Play policy](https://support.google.com/googleplay/android-developer/answer/12085295?hl=en).

For our case (digital signage installer for a paid school district product),
"enterprise device-management" is the path. Document the use-case clearly in
the Play console listing — Play has been rejecting third-party signage apps
that hold this permission without justification.

### 2.3 INSTALL_PACKAGES — the system-only sibling

`INSTALL_PACKAGES` (no `REQUEST_` prefix) is signature-protected and only
granted to apps signed with the platform key. Holding it lets you skip the
per-app toggle entirely. **You cannot hold this on a non-system app.** The
only exception is being granted it by the system as a side-effect of being
**Device Owner** — which is why DO is the only path to "true silent" install
without rooting the device.

Source: [Configure update ownership for apps (AOSP)](https://source.android.com/docs/setup/create/app-ownership).

### 2.4 The "installer of record" concept

Every installed package on the system has an **installer of record** —
the package name returned by
`PackageManager.getInstallSourceInfo(targetPackage).installingPackageName`
(API 30+; pre-30 it's `getInstallerPackageName(targetPackage)`).

If you installed Player initially (e.g. via `pm install` from inside
Manager), Manager **is** the installer of record. This grants you certain
silent-update powers (see §3) even without DO.

Source: [Configure update ownership for apps](https://source.android.com/docs/setup/create/app-ownership),
[PackageInstaller AOSP source](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/pm/PackageInstaller.java).

### 2.5 `setRequestUpdateOwnership(true)` (Android 14+)

A new API in API 34 lets you **claim exclusive update ownership** during
initial install:

```kotlin
val params = PackageInstaller.SessionParams(MODE_FULL_INSTALL)
if (Build.VERSION.SDK_INT >= 34) {
    params.setRequestUpdateOwnership(true)
}
```

Once granted, no other installer (even one with `INSTALL_PACKAGES`) can
silently update the package without user consent. Useful for signage:
prevents Play Store from auto-updating Player out from under our pinned
version.

Source: [Android Developers blog — "Android 14 adds new features for app stores"](https://www.xda-developers.com/android-14-new-apis-app-stores/),
[setRequestUpdateOwnership reference](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.setrequestupdateownership).

Note: requires `ENFORCE_UPDATE_OWNERSHIP` permission. Available only at
**initial install** — calling it on an update is a no-op. So plan to fold
this into Manager's "first-time install" path.

---

## 3. Silent install on Android 12+ (USER_ACTION_NOT_REQUIRED)

### 3.1 The flag

API 31 added `PackageInstaller.SessionParams.setRequireUserAction(int)`:

```kotlin
val params = PackageInstaller.SessionParams(MODE_FULL_INSTALL)
if (Build.VERSION.SDK_INT >= 31) {
    params.setRequireUserAction(
        PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED
    )
}
```

Source: [PackageInstaller.SessionParams.SetRequireUserAction](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.setrequireuseraction),
[USER_ACTION_NOT_REQUIRED constant](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.useractionnotrequired).

### 3.2 When the system honours it

Android 12+ silently installs **only** if all of these hold:

1. **(Caller is Device Owner)** — guaranteed silent. Or:
2. **(Caller holds `UPDATE_PACKAGES_WITHOUT_USER_ACTION`)**
   AND **(caller is the installer of record for `targetPackage`)**
   AND **(caller's last update was committed by the same caller)**.
   Then silent. Or:
3. (As of Android 14) **(target was installed declaring
   `setRequestUpdateOwnership(true)` by THIS caller AND caller is still
   the update owner)**.

If none of these hold, the install drops back to
`STATUS_PENDING_USER_ACTION` and you must surface the standard system
install dialog.

Source: [PackageInstaller.java AOSP source](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/pm/PackageInstaller.java),
[sisik blog — silent updates](https://www.sisik.eu/blog/android/dev-admin/update-app),
[Microsoft appcenter-sdk-android issue #1615](https://github.com/microsoft/appcenter-sdk-android/issues/1615),
[NeoApplications/Neo-Store issue #20](https://github.com/NeoApplications/Neo-Store/issues/20).

### 3.3 Real-world success rate on AOSP-stripped vendor ROMs

What I have seen reported by other signage devs (mostly via dontkillmyapp,
Stack Overflow, and EMM vendor forums):

- **Stock Android 12+ tablets** — works on ~95% of devices when DO is set.
- **Samsung tablets with Knox** — works, but Knox sometimes interposes its
  own "container" dialog. Usually solvable by setting Knox API allowlist.
- **Rockchip-based AOSP boards (RK3288/3399/3588)** — works *if* the
  manufacturer kept `PackageInstaller` system service intact. Some
  signage OEMs (notably TaurusOS pre-2024) replace `PackageInstaller`
  with a custom variant that ignores `USER_ACTION_NOT_REQUIRED`. In
  that case, only DO works.
- **Goodview / TCL CMS-bundled boards** — `STATUS_PENDING_USER_ACTION`
  reliably triggers; silent path is hit-or-miss. Treat both as "expected
  fallback to user dialog."

Practical rule we've validated: **try the silent hint on every install,
fall back gracefully on `STATUS_PENDING_USER_ACTION`** — exactly what
Manager v1.0.16+ already does.

### 3.4 Code template (production-grade)

```kotlin
@RequiresApi(31)
internal object Api31SilentInstall {
    fun configure(params: PackageInstaller.SessionParams) {
        params.setRequireUserAction(SessionParams.USER_ACTION_NOT_REQUIRED)
    }
}

fun installApk(ctx: Context, apk: File, targetPkg: String) {
    val pi = ctx.packageManager.packageInstaller
    val params = SessionParams(MODE_FULL_INSTALL).apply {
        setAppPackageName(targetPkg)
        if (Build.VERSION.SDK_INT >= 31) Api31SilentInstall.configure(this)
        // API 34: claim update ownership on initial install
        if (Build.VERSION.SDK_INT >= 34) setRequestUpdateOwnership(true)
    }
    val sid = pi.createSession(params)
    pi.openSession(sid).use { s ->
        apk.inputStream().use { input ->
            s.openWrite("base.apk", 0, apk.length()).use { out ->
                input.copyTo(out); s.fsync(out)
            }
        }
        val resultIntent = Intent(ctx, OtaInstallReceiver::class.java)
            .setAction("com.educms.OTA_RESULT")
            .putExtra("sessionId", sid)
        val pendingIntent = PendingIntent.getBroadcast(
            ctx, sid, resultIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
        )
        s.commit(pendingIntent.intentSender)
    }
}
```

Notice the **API-31 isolation in a `@RequiresApi(31) object`**. Without
it, ART on Android 11 resolves the API-31 symbols at class-load time and
crashes with `VerifyError`. We learned this in Manager v1.0.4. The
existing `Api31SilentInstall.configure` pattern in
`apps/player/manager/src/main/java/com/educms/manager/Api31SilentInstall.kt`
is the canonical fix; do not regress.

### 3.5 The `STATUS_PENDING_USER_ACTION` fallback

On every install where the silent hint is rejected, the result intent
arrives with:

```kotlin
val status = intent.getIntExtra(EXTRA_STATUS, -999)
when (status) {
    STATUS_SUCCESS -> { /* good */ }
    STATUS_PENDING_USER_ACTION -> {
        val confirmIntent = intent.getParcelableExtra<Intent>(EXTRA_INTENT)!!
        // Need to launch confirmIntent from a foreground context
        // BAL (background-activity-launch) restrictions in Android 10+
        // require either: an Activity, or a notification with full-screen-intent
    }
    else -> { /* failure path */ }
}
```

The full-screen-intent notification trick is Manager's `InstallPromptActivity`
+ `OtaInstallReceiver` pattern. Standard in the industry — see Microsoft
appcenter-sdk's installer flow and Neo-Store / F-Droid's pattern.

Sources: [Microsoft appcenter-sdk install flow](https://github.com/microsoft/appcenter-sdk-android/issues/1615),
[F-Droid Neo-Store discussion](https://github.com/NeoApplications/Neo-Store/issues/20).

---

## 4. CATEGORY_HOME / launcher replacement strategies

### 4.1 The two ways to be "the home screen"

```xml
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.HOME" />
    <category android:name="android.intent.category.DEFAULT" />
</intent-filter>
```

If you declare `CATEGORY_HOME` and the user picks your app as the default
launcher, you become the home screen. **Always-default** can only be set
by either the user picking "Always" in the chooser, or the DPC programmatically:

```kotlin
val intentFilter = IntentFilter(Intent.ACTION_MAIN).apply {
    addCategory(Intent.CATEGORY_HOME)
    addCategory(Intent.CATEGORY_DEFAULT)
}
dpm.addPersistentPreferredActivity(
    adminComponent,
    intentFilter,
    ComponentName(context, MainActivity::class.java)
)
```

Source: [DevicePolicyManager.addPersistentPreferredActivity](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#addPersistentPreferredActivity),
[mrugacz95/kiosk sample](https://github.com/mrugacz95/kiosk),
[innovation-system/android-kiosk](https://github.com/innovation-system/android-kiosk).

The `addPersistentPreferredActivity` call only works on Device Owner — and
that's important context for our case.

### 4.2 The OEM launcher displacement risk (we hit this)

We learned this the hard way 2026-04-21 (per our Manifest comment): on
OEM signage boxes that already ship a proprietary CMS launcher (Goodview,
NovaStar, TCL), registering `CATEGORY_HOME` on Player makes Android pop
the "pick a default" chooser. If our app wins (or the operator clicks
"Always"), we **displace the OEM launcher**, breaking:

- Their CMS dashboard
- Their network-settings flow
- Their content sync
- The kiosk on their portal

The fix that's already in place: **omit `CATEGORY_HOME` entirely.** Player
is a guest, not the host. The OEM is the host.

### 4.3 The kiosk-only build flavour pattern

For greenfield deployments where there is no OEM CMS, we may want to be
the launcher. The standard pattern is a separate Gradle flavour:

```kotlin
// apps/player/app/build.gradle.kts
android {
    flavorDimensions += "deployment"
    productFlavors {
        create("guest") {
            dimension = "deployment"
            // No HOME filter — co-exists with OEM CMS
        }
        create("kiosk") {
            dimension = "deployment"
            applicationIdSuffix = ".kiosk"
            // Drives a separate AndroidManifest.xml that adds CATEGORY_HOME
            manifestPlaceholders["categoryHome"] = "true"
        }
    }
}
```

Then in `AndroidManifest.xml`:

```xml
<intent-filter>
    <action android:name="android.intent.action.MAIN" />
    <category android:name="android.intent.category.LAUNCHER" />
    <!-- HOME only injected for kiosk flavour via manifest placeholder -->
    <!-- ${categoryHome=='true'} guarded with build variant logic -->
</intent-filter>
```

Or simpler: have a `kiosk/AndroidManifest.xml` that overlays the base
manifest with the extra `CATEGORY_HOME` filter. Gradle's flavour-specific
manifest merging handles this natively.

### 4.4 Why "screen pinning mode" is NOT a launcher replacement

Screen pinning (the user-confirmation-required `startLockTask()` from
non-DO apps) is **not** the same as being the launcher. It pins the
foreground task — but if the task crashes or the system kills it, the
device returns to the OEM launcher. For a true kiosk, you need both:

- (a) `CATEGORY_HOME` so you're the home screen on every "back to home"
- (b) Lock Task Mode so the user can't escape the foreground task

For our "guest mode" deployments, we get neither — we rely on the OEM
launcher to auto-launch us, plus our own `BootReceiver` and Watchdog.

Sources: [Hexnode kiosk mode](https://www.hexnode.com/blogs/what-is-android-lock-task-mode/),
[Android kiosk-mode COSU comparison](https://www.appaloosa.io/blog/kiosk-mode).

---

## 5. Lock Task Mode (kiosk pinning) specifics

### 5.1 The two flavours

| Mode | Caller | UX |
|---|---|---|
| **Pinned** (DO) | Device Owner with `setLockTaskPackages` allowlisting | Activity enters lock-task instantly, no dialog, user cannot exit without DO release |
| **Pinned** (non-DO) | Any app calling `startLockTask()` from `onResume()` | System shows confirmation dialog "App is pinned. Hold Back+Recents to unpin." User can exit |

Source: [Lock task mode docs](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode).

### 5.2 The lock-task feature bitfield (API 28+)

```kotlin
val features =
    DevicePolicyManager.LOCK_TASK_FEATURE_HOME or       // show home button
    DevicePolicyManager.LOCK_TASK_FEATURE_NOTIFICATIONS or  // allow notifications
    DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS or // long-press power
    DevicePolicyManager.LOCK_TASK_FEATURE_KEYGUARD or   // allow lockscreen
    DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO or
    DevicePolicyManager.LOCK_TASK_FEATURE_OVERVIEW
dpm.setLockTaskFeatures(adminComponent, features)
```

Default (when `setLockTaskFeatures` isn't called or set to
`LOCK_TASK_FEATURE_NONE`) is `LOCK_TASK_FEATURE_GLOBAL_ACTIONS` only —
power-button menu, status bar fully blank. For most kiosks that's perfect.

For **emergency-capable signage** (our case, where staff need to be able
to trigger a long-press power-off), keep `LOCK_TASK_FEATURE_GLOBAL_ACTIONS`
on. Disable everything else.

Source: [setLockTaskFeatures reference](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setLockTaskFeatures),
[Ezurio reference](https://www.ezurio.com/documentation/introduction-to-android-lock-task-mode-kiosk-mode).

### 5.3 The activity attribute `android:lockTaskMode`

Available values:

| Value | Behaviour |
|---|---|
| `normal` | Default — no lock-task behavior unless explicitly started by app or DPC |
| `never` | Activity refuses lock-task mode, even if package is allowlisted |
| `if_whitelisted` | If package is in `setLockTaskPackages`, activity auto-enters lock-task on launch |
| `always` | Activity always runs in lock-task mode, ignores allowlist (DO-only) |

The clean kiosk pattern: **`android:lockTaskMode="if_whitelisted"`** on
`MainActivity` plus a Manager call to `setLockTaskPackages` listing
`com.educms.player`.

### 5.4 Hardware-button / system-UI control

Within Lock Task, the system **already** suppresses:

- Recents (always — only the foreground task is reachable)
- Home button (unless `LOCK_TASK_FEATURE_HOME` is on)
- Status bar pull-down (unless `LOCK_TASK_FEATURE_NOTIFICATIONS`)
- Notifications drawer
- Long-press power options (unless `LOCK_TASK_FEATURE_GLOBAL_ACTIONS`)
- Lockscreen (unless `LOCK_TASK_FEATURE_KEYGUARD`)

Things that **still leak** without additional work:

- Volume buttons → handled by overriding `onKeyDown` in your Activity, OR
  by `setUserRestriction(UserManager.DISALLOW_ADJUST_VOLUME)` (DO-only)
- Power button (single press to sleep) → cannot be intercepted from app code;
  use `WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON` + DPM
  `setKeyguardDisabled(true)` so the screen comes back instantly
- Hardware "menu" or vendor-specific buttons → vendor-specific; usually
  not present on signage boards

Sources: [Lock task mode docs](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode),
[Hexnode hardware button forum](https://www.hexnode.com/forums/topic/is-it-possible-to-disable-hardware-buttons-and-status-bar-in-android-kiosk-mode/),
[Scalefusion status-bar guide](https://blog.scalefusion.com/hide-status-and-notification-bar-in-android/).

### 5.5 The status-bar-disabled (DO-only) trick

For "absolutely no swipe-down" on Android 6+:

```kotlin
if (dpm.isDeviceOwnerApp(context.packageName)) {
    dpm.setStatusBarDisabled(adminComponent, true)
}
```

Source: [DevicePolicyManager.setStatusBarDisabled](https://developer.android.com/reference/android/app/admin/DevicePolicyManager#setStatusBarDisabled).

Even during Immersive Mode, swipe-from-top can still expose the status bar.
`setStatusBarDisabled(true)` makes the swipe completely inert.

### 5.6 Using lock task without DO

For our "guest" build flavour where Manager is NOT DO, you can still get
some kiosk benefit:

```kotlin
override fun onResume() {
    super.onResume()
    if (Build.VERSION.SDK_INT >= 21) {
        // System shows "Pin to screen" confirmation dialog. After user OKs,
        // back+recents long-press required to exit.
        startLockTask()
    }
}
```

This shows a one-time confirmation. Operator/installer answers yes during
deployment. Once pinned, casual viewers cannot exit without the right
gesture. Not bulletproof, but better than nothing.

Source: [Activity.startLockTask](https://learn.microsoft.com/en-us/dotnet/api/android.app.activity.startlocktask).

---

## 6. Foreground service patterns for keep-alive

### 6.1 Android 14 typed FGS — the rule

Every foreground service must declare a `foregroundServiceType` AND the
matching typed permission:

| Type | When | Typed permission |
|---|---|---|
| `dataSync` | Network upload/download, content sync | `FOREGROUND_SERVICE_DATA_SYNC` |
| `mediaPlayback` | Audio/video playback | `FOREGROUND_SERVICE_MEDIA_PLAYBACK` |
| `specialUse` | Catch-all needing a written justification | `FOREGROUND_SERVICE_SPECIAL_USE` |
| `systemExempted` | DO/PO/VPN/emergency-role apps only | `FOREGROUND_SERVICE_SYSTEM_EXEMPTED` |
| `shortService` | <3 min critical work | (none — only `FOREGROUND_SERVICE`) |

Source: [Foreground service types are required](https://developer.android.com/about/versions/14/changes/fgs-types-required),
[Foreground service types reference](https://developer.android.com/develop/background-work/services/fgs/service-types).

### 6.2 Choosing for kiosk signage

Our two services:

1. **HeartbeatService** (Player) — pings `/screens/status` every 30s.
   - Today: `dataSync`. Correct for the heartbeat itself.
   - **2025+ catch:** Android 15 enforces a **6-hour max runtime** on
     `dataSync` FGS. After 6h the system stops the service, forcing a
     restart. Good for short transfers; **not ideal for an
     always-on heartbeat.**
   - Source: [Foreground service types reference](https://developer.android.com/develop/background-work/services/fgs/service-types).
   - **Better choice for always-on heartbeat:** `specialUse` with a
     `<property name="android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE"
     value="..." />` justifying continuous device health reporting.
     Or — **once Manager is DO** — `systemExempted` (no timeout, no
     justification needed).

2. **WatchdogService** (Manager) — polls Player heartbeat every 30s.
   - Same situation. `specialUse` if non-DO; `systemExempted` if DO.

### 6.3 The 11-layer "keep-alive" stack

Stoyan Minchev's article on `dev.to` is the canonical reference for
surviving OEM battery-saver kills. The layers, ranked by reliability:

1. **Hardware sensor HAL polling** — invisible to OEM kill logic. Highest
   reliability but limited to "thing happens" triggers.
2. **Foreground service** — 97.3% execution certainty. **Best practical
   choice for signage.**
3. **Periodic AlarmManager `setAndAllowWhileIdle()`** — exempt from doze.
4. **WorkManager periodic worker** — 26.2% cancellation under battery saver.
5. **JobScheduler** — also subject to OEM throttling.
6. **`BOOT_COMPLETED` + `LOCKED_BOOT_COMPLETED`** receiver — relaunches us
   on every reboot.
7. **`MY_PACKAGE_REPLACED` + `PACKAGE_REPLACED`** — relaunches after our own
   or peer's updates (already in our Manager).
8. **`ACTION_BATTERY_CHANGED` periodic** — fires every few minutes, lets us
   do health checks even when nothing else is firing.
9. **High-priority broadcast PendingIntent** from a long-running service.
10. **Watchdog FGS in a SEPARATE process** (already in our Manager) — if
    one crashes, the other restarts it.
11. **Companion APK with separate UID** (already in our Manager+Player
    architecture).

Source: [dev.to — "What Android OEMs do to background apps, and the 11 layers I built to survive it"](https://dev.to/stoyan_minchev/what-android-oems-do-to-background-apps-and-the-11-layers-i-built-to-survive-it-28bb).

Our Manager+Player architecture is already at layer 10-11. The remaining
gap: we should re-evaluate `dataSync` → `specialUse` for the heartbeat
service to dodge the 6-hour timeout on Android 15.

### 6.4 Battery optimization exemption

`REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` lets you prompt the user to
whitelist your app for doze. **Play prohibits this for general apps**;
allowed for "core function would be adversely affected". Signage qualifies.

```kotlin
val intent = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
    .setData("package:${context.packageName}".toUri())
context.startActivity(intent)
```

Once granted: `PowerManager.isIgnoringBatteryOptimizations(packageName)` is
`true`. App can use network and hold partial wake locks during doze.

Source: [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby),
[REQUEST_IGNORE_BATTERY_OPTIMIZATIONS reference](https://zahidaz.github.io/awake/permissions/normal/request-ignore-battery-optimizations/).

### 6.5 OEM autostart / battery saver layers

`dontkillmyapp.com` documents per-OEM background restrictions. Highlights:

- **Xiaomi / MIUI**: Settings → Apps → \[App] → Battery saver →
  No restrictions; AND Permissions → Autostart → enable.
- **Vivo**: i Manager → App manager → Autostart manager → enable.
- **Oppo / OnePlus / ColorOS**: Settings → Battery → \[App] → Allow
  background activity.
- **Samsung**: Device care → Battery → 3-dot menu → Settings → uncheck
  "Put unused apps to sleep".

Sources: [dontkillmyapp Xiaomi](https://dontkillmyapp.com/xiaomi),
[dontkillmyapp Vivo](https://dontkillmyapp.com/vivo),
[dontkillmyapp main](https://dontkillmyapp.com/).

For locked-down OEMs without these UIs (TaurusOS / Goodview): the only
escape is DO + `setUserRestriction(UserManager.DISALLOW_APPS_CONTROL,
false)` + `setRestrictBackgroundData(false)`.

### 6.6 User-Initiated Data Transfer (UIDT) for OTA downloads

Android 14 introduces UIDT jobs as a replacement for `dataSync` FGS for
**long downloads**:

```kotlin
val ji = JobInfo.Builder(JOB_ID, ComponentName(ctx, OtaDownloadJob::class.java))
    .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
    .setUserInitiated(true)  // <-- API 34
    .setEstimatedNetworkBytes(apkSizeBytes, apkSizeBytes)
    .build()
ctx.getSystemService(JobScheduler::class.java).schedule(ji)
```

Benefits over FGS for OTAs:

- Not subject to FGS quota / timeout
- Survives 6h `dataSync` cap
- Google Maps reported 10% download reliability improvement after migrating

Caveat: requires API 34. Use WorkManager's `setForegroundAsync` as a
pre-A14 fallback.

Source: [User-Initiated Data Transfer reference](https://developer.android.com/develop/background-work/background-tasks/uidt),
[Android Developers blog — Google Maps UIDT migration](https://android-developers.googleblog.com/2024/09/google-maps-improved-download-reliability-user-initiated-data-transfer-api.html).

---

## 7. WebView compatibility on old Chromium

### 7.1 What ships on RK3288 boards

NovaStar Taurus TB30 (RK3288) — based on Android 7.1.2 by default. Stock
WebView is **Chromium 60-65** if the OEM left it stock. Some shipped
boards have System WebView locked at older versions (Chromium 53-56)
because the OEM bundled a fixed AOSP WebView and froze the package.

Source: [WebView providers documentation](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/webview-providers.md),
[WebView for AOSP system integrators](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/aosp-system-integration.md).

### 7.2 What's missing on Chromium 60-75

| API | First shipped | Issue on stripped WebView |
|---|---|---|
| `fetch()` | Chromium 42 | OK on most |
| `AbortController` | Chromium 66 | Missing on really old (53-65) |
| `ReadableStream` | Chromium 43 | OK |
| `Web Crypto` (`crypto.subtle`) | Chromium 37 | OK on HTTPS only |
| `Service Worker` | Chromium 40 / WebView Chrome 75 | **Broken in WebView 75 specifically** — see Chromium issue 977784 |
| TLS 1.3 | Chrome 70 | Missing on Chromium <70 |
| `IntersectionObserver` | Chromium 51 | OK on most |
| `ResizeObserver` | Chromium 64 | Missing on <64 |
| `Object.fromEntries`, `String.matchAll` (ES2019) | Chromium 73 | Missing on <73 |
| Optional chaining `?.` (ES2020) | Chromium 80 | **Critical** — most modern frontends use this |
| Nullish coalescing `??` | Chromium 80 | Same |
| `globalThis` | Chromium 71 | Missing on <71 |

Sources: [WebView platform compatibility](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/web-platform-compatibility.md),
[Chromium issue 977784 — Chrome 75 ServiceWorker fetch fail](https://issues.chromium.org/issues/41467394),
[Zebra WebView TLS compliance](https://techdocs.zebra.com/enterprise-browser/2-0/guide/compliance/).

### 7.3 Concrete defenses

#### 7.3.1 Babel/SWC compile target = ES2017 or earlier

For a Next.js frontend served to old WebView:

```js
// next.config.mjs
export default {
  experimental: {
    swcPlugins: [],
  },
  // For full IE11/old-WebView coverage, rebuild target to ES2017.
  // ES2017 has async/await native; everything beyond gets transpiled.
  // Even better: target "es2015" for the absolutely-locked-down boards.
}
```

Additionally, a `browserslist` config:

```json
{
  "browserslist": [
    "Chrome >= 60",
    "ChromeAndroid >= 60",
    "Android >= 7"
  ]
}
```

This makes `next build` emit code that's safe for Chromium 60+. Most of
our older boards meet that.

#### 7.3.2 Polyfills loaded conditionally

```html
<script>
  if (!('fromEntries' in Object) || !window.AbortController) {
    document.write('<script src="/polyfills.js"><\/script>');
  }
</script>
```

`/polyfills.js` should load only on demand — modern devices skip it.

#### 7.3.3 ServiceWorker bypass

For boards on Chromium 75 specifically (where SW + fetch is broken),
disable SW registration entirely on those user-agents:

```js
const ua = navigator.userAgent;
const chromiumMatch = ua.match(/Chrome\/(\d+)/);
const ver = chromiumMatch ? parseInt(chromiumMatch[1]) : 0;
if (ver >= 80 && 'serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw-player.js');
}
```

This is what we already do implicitly via Service Worker scope; making
it explicit avoids the buggy 75 path.

#### 7.3.4 `androidx.webkit` for native-side help

The `androidx.webkit` (Jetpack Webkit) library provides feature-detected
proxies for many WebView APIs:

- `WebViewCompat.isFeatureSupported(...)` — runtime feature detection
- `ServiceWorkerControllerCompat` — controlled SW behaviour from Kotlin
- `WebViewAssetLoader` — serve assets via `https://localhost/...` instead
  of `file://`, side-stepping the file-scheme deprecation in API 30+

We already use `androidx.webkit:webkit:1.11.0`. Lean on it more.

Source: [WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat),
[Jetpack Webkit overview](https://developer.android.com/develop/ui/views/layout/webapps/jetpack-webkit-overview).

#### 7.3.5 TLS 1.3 fallback

For boards with Chromium <70 (no TLS 1.3), make sure your CDN/server
allows TLS 1.2 fallback. Vercel + most HTTPS endpoints do; if you're
fronting any service that's TLS-1.3-only, those boards will fail.

### 7.4 Last-resort: bundled WebView

If a deployment has a board with an unworkably old WebView, you can ship
a self-contained Chromium via **GeckoView** or **bromite**:

- GeckoView (Mozilla's embeddable Firefox engine, 80MB APK overhead)
- Bromite/Cromite (sideload-able Chromium WebView replacement)

For our 9.5MB Player+Manager bundle this is a last resort, but worth
documenting. KioskZen does exactly this for HomeAssistant kiosks:
https://github.com/exraaaa/KioskZen.

Source: [KioskZen GitHub](https://github.com/exraaaa/KioskZen).

---

## 8. OTA update strategies that actually work without DEVICE_OWNER

### 8.1 The matrix

| Path | Silent? | Pre-conditions |
|---|---|---|
| Android 6-7 + DO | ✓ | DO |
| Android 12+ + DO | ✓ | DO |
| Android 12+ + non-DO + installer-of-record + `UPDATE_PACKAGES_WITHOUT_USER_ACTION` | ✓ | First install must have been by us |
| Android 14+ + non-DO + `setRequestUpdateOwnership(true)` claimed at install time | ✓ | Initial install only — locks future updates to us |
| Android 7+ + REQUEST_INSTALL_PACKAGES | User-action prompt | Operator OK once per install |
| `pm set-installer com.educms.manager com.educms.player` (root only) | Sometimes | Root or permissive AOSP |
| `pm install` from system shell | ✓ | Root or `adbd` running as root |

### 8.2 The companion-app-as-installer pattern (our current architecture)

This is the gold-standard non-DO pattern, used by:

- **OnSign TV** (signage CMS — companion app)
- **Yodeck Android** (dual APK — Player + Player Updater)
- **Esper Foundation** (Esper Agent + Managed Apps)
- **EduCMS Manager + Player** (us)

Why it works:

- The companion app holds `REQUEST_INSTALL_PACKAGES` and the user-grant
  toggle separately
- Once Manager installs Player, Manager is the **installer of record**;
  silent updates are possible (case 3 in §8.1)
- Manager + Player run as different UIDs so a Player crash can't take
  Manager down
- Cross-app heartbeat IPC (we use ContentProvider with signature-protected
  permission) — robust across UIDs

The remaining trick we've already implemented: **Manager bundled inside
Player's `assets/bundled/edu-cms-manager.apk`** so Manager can be
installed at first run from local disk. No network round-trip, no Vercel
dependency, no GitHub rate limit.

### 8.3 `pm set-installer`

Once per device, with ADB:

```
adb shell pm set-installer com.educms.player com.educms.manager
```

This rewrites the installer-of-record metadata for Player to claim
Manager as the installer. Useful if Player was sideloaded first and
Manager came later.

Note: requires `pm` shell access (always present, no root needed for
this command).

### 8.4 `setRequestUpdateOwnership` for new deployments

For Android 14+ kiosks deployed fresh:

```kotlin
if (Build.VERSION.SDK_INT >= 34) {
    params.setRequestUpdateOwnership(true)  // initial install of Player
}
```

Manager claims ownership of Player updates. Even if Play Store later
tries to push a new Player APK, the system shows a user prompt. Our
silent-OTA path stays exclusive to us. Source: [Android 14 update ownership](https://www.xda-developers.com/android-14-new-apis-app-stores/).

### 8.5 Notification + FullScreenIntent prompt pattern

When `STATUS_PENDING_USER_ACTION` returns and Manager has no
`MainActivity` to bring forward (Manager is a daemon by design), the
trick is:

1. Build a high-priority Notification with a `setFullScreenIntent` to
   `InstallPromptActivity`
2. `InstallPromptActivity` is a `Theme.Translucent.NoTitleBar` Activity
   that immediately starts the system's `EXTRA_INTENT` from the
   STATUS_PENDING_USER_ACTION callback
3. Activity finishes itself — operator sees only the system's "Install /
   Cancel" dialog
4. After OK, install proceeds; no hint of Manager UI ever shown

This bypasses Android 10+ Background Activity Launch (BAL) restrictions.
We already do this in Manager's `InstallPromptActivity`. **Don't break it.**

Source: [Background Activity Launch — Android Developers](https://developer.android.com/guide/components/activities/background-starts).

---

## 9. Network bootstrapping on no-GMS devices

### 9.1 NTP without GMS

GMS-equipped Android calls `time.android.com`. AOSP-stripped builds
sometimes (a) leave that endpoint working, (b) replace it with a custom
endpoint, (c) leave the time-sync service entirely broken.

For JWT signature verification (which is clock-sensitive) we cannot
trust the system clock. **Do our own NTP sync.**

The two production-grade Kotlin libraries:

- **Kronos-Android** by Lyft (https://github.com/lyft/Kronos-Android) —
  maintains a "trusted clock" by polling a configurable NTP pool
- **TrueTime-Android** by Instacart (https://github.com/instacart/truetime-android)
  — original; recently rewritten in Kotlin/Coroutines

```kotlin
// Kronos
val kronos = AndroidClockFactory.createKronosClock(
    context,
    syncListener = null,
    ntpHosts = listOf("time.cloudflare.com", "pool.ntp.org", "0.android.pool.ntp.org")
)
kronos.syncInBackground()
val now = kronos.getCurrentTimeMs()
```

Source: [Kronos-Android](https://github.com/lyft/Kronos-Android),
[TrueTime-Android](https://github.com/instacart/truetime-android),
[Network time detection (AOSP)](https://source.android.com/docs/core/connect/time/network-time-detection).

For DO setups: `dpm.setAutoTimeRequired(true)` forces NTP-only and
prevents operator clock skew from breaking our heartbeat.

### 9.2 Captive portal detection

Android 11+ supports DHCP option 114 (RFC 7710bis) for captive-portal
API endpoints — the device automatically detects captive portals via
DHCP without GMS. On older builds, Android falls back to:

```
GET http://connectivitycheck.android.com/generate_204
```

— expects a 204 response. If intercepted, captive portal is detected.

For our case (no-GMS):

- **Always allow our heartbeat to fail and retry** — we already do this
  via `NetworkRecoveryController`
- **Detect captive portal explicitly** by hitting our own
  `/api/v1/health` and checking for non-200 + Content-Type=text/html
  (sign of captive portal interception)
- **Surface "captive portal" status to the operator UI** — already in
  the Player's web app via `/player/status`

Source: [Captive portal API support](https://developer.android.com/about/versions/11/features/captive-portal),
[Android captive portal detection](https://android.googlesource.com/platform/external/libwebsockets.git/+/refs/heads/main/READMEs/README.captive-portal-detection.md).

### 9.3 DNS reliability

Vendor-locked AOSP boards sometimes hardcode DNS to a (vendor-controlled)
endpoint. Two consequences:

1. We can't override DNS at the system level without DO + privileged
   permissions
2. If vendor DNS fails, our app fails

Mitigation:

- Use **DNS-over-HTTPS (DoH)** from inside our app for critical lookups.
  Cloudflare's `1.1.1.1/dns-query` works without any system config:

```kotlin
val client = OkHttpClient.Builder()
    .dns(DnsOverHttps.Builder()
        .client(OkHttpClient())
        .url("https://1.1.1.1/dns-query".toHttpUrl())
        .build())
    .build()
```

OkHttp's DoH integration sidesteps vendor DNS entirely.

### 9.4 Ethernet vs WiFi auto-config

Most NovaStar Taurus boards have both Ethernet and WiFi. Default Android
priority is Ethernet > WiFi > Cellular. For DO setups:

```kotlin
// Force WiFi over Ethernet (rarely needed but sometimes useful)
dpm.setApplicationRestrictions(adminComponent, packageName, Bundle().apply {
    putString("network_preference", "WIFI")
})
```

Without DO, you cannot reorder transports — but you can pin connections
to a specific transport via `NetworkRequest`:

```kotlin
val req = NetworkRequest.Builder()
    .addTransportType(NetworkCapabilities.TRANSPORT_ETHERNET)
    .build()
connectivityManager.requestNetwork(req, callback)
```

### 9.5 The "first-run network" problem

On a fresh kiosk (factory reset, or freshly sideloaded):

1. Our APK boots
2. Network is not yet configured (operator needs to set WiFi or plug
   Ethernet)
3. Player needs to register

The standard signage approach: **show a fallback "configure network"
screen** that links to system Settings:

```kotlin
fun openNetworkSettings(ctx: Context) {
    val intent = Intent(Settings.ACTION_WIFI_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    ctx.startActivity(intent)
}
```

For DO setups, you can pre-configure WiFi via the QR-code provisioning
extras (`PROVISIONING_WIFI_SSID` / `PROVISIONING_WIFI_PASSWORD`).

---

## 10. Patterns from the digital-signage / EMM industry

### 10.1 Xibo (open source, ~$3-4M ARR)

- Player APK: paid, but Xibo CMS is fully open-source
- Architecture: `xiboplayer-kiosk` package configures dedicated Linux
  user, autologin, fullscreen
- Native Android client uses ExoPlayer + WebView
- Communicates via SOAP + XMR (real-time control channel)
- Sources:
  https://github.com/xibo-players,
  https://www.xiboplayer.org/downloads/

### 10.2 OnSign TV

- Native Android via APK; supports OEM kiosk modes (LG webOS, Samsung
  Tizen, BrightSign, NovaStar Taurus)
- Documented Taurus-specific deployment guide:
  https://docs.onsign.com/android/novastar-taurus-android
- Companion-app pattern: OnSign Player + OnSign Player Updater
- Notes the PlayService process needs to be stopped / disabled before
  running the OnSign player on Taurus

### 10.3 Yodeck

- Splits Android Player + APK Updater
- Documented dual-APK install flow:
  https://www.yodeck.com/docs/creating-a-yodeck-player/setting-up-an-android-player-with-the-yodeck-software-via-apk/
- Supports BrightSign as alternative (BrightScript runtime)

### 10.4 OptiSigns

- Single APK, but uses Samsung Knox Configure / SafeUEM / Hexnode for
  enrollment
- Notes that Samsung Knox Guard on Android 15 blocks Android Enterprise
  provisioning by default — requires Samsung partnership to unblock
- Source: https://www.optisigns.com/post/using-an-android-device-for-digital-signage

### 10.5 BrightSign

- Not Android — proprietary Linux + BrightScript runtime
- Strong reliability story but locked-in hardware
- Yodeck's BrightSign integration: drop folder of BrightScript files on
  SD card, BrightSign auto-runs

### 10.6 EMM playbooks (Esper, Hexnode, Scalefusion, ManageEngine)

These are the productised versions of everything above:

| Vendor | DPC | AOSP/non-GMS support | Provisioning |
|---|---|---|---|
| **Esper** | Foundation OS + Esper DPC + DPC Launcher | Strong (Foundation OS is AOSP-based) | Seamless (serial-based), QR, ADB Device Provisioner tool |
| **Hexnode** | Hexnode for Work | Mixed; depends on device | QR, NFC, Knox Mobile Enrollment |
| **Scalefusion** | Scalefusion DPC | Strong; known to deploy NovaStar Taurus | QR, Zero-touch, ADB |
| **ManageEngine MDM** | ME MDM Agent | Stronger on Knox; limited AOSP | KME, QR, custom DPC |

Key insight: **all four offer a "Device Provisioner" desktop tool** — a
Windows/Mac/Linux app that runs `dpm set-device-owner` over ADB during
install. This is the same pattern we should adopt for our deployment
flow on TaurusOS.

Sources: [Esper provisioning methods](https://www.esper.io/blog/android-provisioning-options-available-on-esper),
[Esper Device Provisioner](https://help.esper.io/hc/en-us/articles/12311253854609-Esper-Device-Provisioner),
[Esper Foundation](https://www.esper.io/products/esper-foundation),
[Hexnode kiosk launcher setup](https://www.hexnode.com/mobile-device-management/help/how-to-set-up-kiosk-launcher-on-android-devices-with-hexnode/),
[Scalefusion kiosk solution](https://scalefusion.com/kiosk-solution/features),
[ManageEngine silent install](https://www.manageengine.com/mobile-device-management/how-to/mdm-silent-installation-android-apps.html).

### 10.7 Open-source kiosk launcher reference implementations

- **innovation-system/android-kiosk** — Webview kiosk + lock task in
  Kotlin: https://github.com/innovation-system/android-kiosk
- **nktnet1/webview-kiosk** — kiosk with PIN + lock task:
  https://github.com/nktnet1/webview-kiosk
- **isurusen/kiosk-android** — minimal sample:
  https://github.com/isurusen/kiosk-android
- **mrugacz95/kiosk** — DPC + kiosk launcher:
  https://github.com/mrugacz95/kiosk
- **PerfsolTech/Android-AutoStart-App** — boot-completed pattern:
  https://github.com/PerfsolTech/Android-AutoStart-App
- **Free-Software-for-Android/NTPSync** — NTP without GMS:
  https://github.com/Free-Software-for-Android/NTPSync
- **squareetlabs/capacitor-dont-kill-my-app** — OEM autostart
  workarounds: https://github.com/squareetlabs/capacitor-dont-kill-my-app

---

## 11. What this means for the EduCMS Player APK

### 11.1 The current state vs. best-practice gap

Our existing architecture is already at the upper-decile of signage-app
robustness:

- ✅ Companion-app pattern (Manager + Player)
- ✅ Cross-process IPC via signature-protected ContentProvider
- ✅ `Api31SilentInstall` API-31-isolated for ART safety
- ✅ Watchdog FGS in separate process
- ✅ BootReceiver + LOCKED_BOOT_COMPLETED
- ✅ Stable debug keystore (kills `INSTALL_FAILED_UPDATE_INCOMPATIBLE`)
- ✅ Per-ABI splits + universal APK
- ✅ `setAppPackageName(targetPackage)` defends against APK swap
- ✅ Bundled Manager APK in Player assets (no network bootstrap)
- ✅ FullScreenIntent + InstallPromptActivity for BAL bypass
- ✅ Deliberately no `CATEGORY_HOME` (we learned that one already)

The remaining gaps:

- ❌ Manager not auto-provisioned as Device Owner — operators run the
  ADB command manually if at all. This is the **single highest-leverage
  change.** All silent-install + lock-task benefits flow from DO.
- ❌ Heartbeat FGS uses `dataSync` — ticking time bomb on Android 15+
  (6h timeout)
- ❌ No NTP fallback — we trust the system clock for JWT verification
- ❌ No `setRequestUpdateOwnership(true)` on initial Player install
- ❌ No `androidx.webkit` feature detection — we'd benefit from polyfilling
  the tiny number of frontend uses that break on Chromium 60-70
- ❌ No `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` prompt — relies on operator
  to manually whitelist
- ❌ No `pm set-installer` rescue path documented for orphaned Players

### 11.2 Top 7 specific code-level changes (executive summary)

See the calling agent's response for the executive summary; the ranked
backlog below is the working implementation plan.

### 11.3 Implementation backlog (ranked)

| # | Change | Effort | Risk | Payoff |
|---|---|---|---|---|
| 1 | Provisioner tool: small CLI (Node or Kotlin/Java jar) that does `adb shell dpm set-device-owner com.educms.manager/.AdminReceiver` automatically on every freshly-paired kiosk. Ship with the Player APK download. Operators run once from the dashboard. | M | Low | Unlocks every other DO benefit |
| 2 | Switch `HeartbeatService` foregroundServiceType from `dataSync` → `specialUse`. Add `FOREGROUND_SERVICE_SPECIAL_USE` permission and the property element with a written justification. Eliminates the 6h Android 15 timeout. | S | Low | Future-proofing |
| 3 | Add `setRequestUpdateOwnership(true)` to `OtaInstaller.installApk()` on initial Player install (API 34+). Wraps in `if (Build.VERSION.SDK_INT >= 34)`. | XS | Low | Locks out Play Store auto-update of Player |
| 4 | Add Kronos-Android NTP sync at Manager startup. Use `kronos.getCurrentTimeMs()` for any clock-sensitive operation (JWT validation in particular). | S | Low | Protects against clock skew |
| 5 | Add `kiosk` Gradle product flavour to Player with `CATEGORY_HOME` enabled. Ship as a separate APK for greenfield deployments without OEM CMS. | M | Low | Greenfield kiosk deployments |
| 6 | Add `REQUEST_IGNORE_BATTERY_OPTIMIZATIONS` permission + first-run prompt. Surface in Player's web UI as "Step 2 of pairing." Falls through harmlessly when Manager is DO. | S | Low | OEMs without DO |
| 7 | Add OkHttp `DnsOverHttps` for our API host on Player. Falls back to system DNS. Rules out vendor-DNS-broke as a failure mode. | S | Low | Locked-down vendor DNS |
| 8 | Add `androidx.webkit.WebViewCompat.isFeatureSupported` checks for: `setSafeBrowsingAllowlist`, `setForceDark`, `WEB_RESOURCE_REQUEST_HEADERS`. Lets us run on Chromium 60-65 without crashes. | S | Low | Old WebView coverage |
| 9 | Add `setLockTaskPackages` + `setLockTaskFeatures` calls in Manager when DO. Configure for `LOCK_TASK_FEATURE_GLOBAL_ACTIONS` only (allow long-press power for staff but kill everything else). | S | Med | Real kiosk experience |
| 10 | Add `setStatusBarDisabled(true)` and `setKeyguardDisabled(true)` when DO. | XS | Low | Cleaner UI |

The real cost is item 1 — the auto-provisioner. Items 2-10 are point
patches.

### 11.4 The "Provisioner Tool" design sketch

A small Node CLI bundled with the Player APK download:

```bash
# Download from dashboard: provision-kiosk-{version}.zip
unzip provision-kiosk-1.0.51.zip
cd provision-kiosk-1.0.51

# Plug in the kiosk via USB, enable ADB on it, then:
node ./provision.mjs
```

`provision.mjs`:

```js
import { execFileSync } from 'node:child_process';

// 1. Verify ADB connection
console.log('Checking ADB...');
execFileSync('adb', ['devices']);

// 2. Install Manager (if not already)
console.log('Installing Manager APK...');
execFileSync('adb', ['install', '-r', 'edu-cms-manager.apk']);

// 3. Set DEVICE_OWNER
console.log('Setting Manager as Device Owner...');
execFileSync('adb', [
  'shell', 'dpm', 'set-device-owner',
  'com.educms.manager/.AdminReceiver'
]);

// 4. Install Player (Manager will be installer-of-record)
console.log('Installing Player APK as Manager...');
execFileSync('adb', [
  'shell', 'pm', 'install',
  '--installer-package-name', 'com.educms.manager',
  '/sdcard/Download/edu-cms-player.apk'
]);

// 5. Grant battery whitelist
execFileSync('adb', [
  'shell', 'dumpsys', 'deviceidle', 'whitelist',
  '+com.educms.player', '+com.educms.manager'
]);

// 6. Disable OEM autostart kill list (best-effort, vendor-specific)
console.log('Done. Reboot kiosk to verify.');
```

This script + the `provision.mjs` source becomes our "kiosk install
pack" download from the dashboard. School IT plugs in the device, runs
the script, walks away. Same UX as Esper Device Provisioner.

### 11.5 What NOT to do (the hard-won list)

Don't repeat these mistakes. Each one has been re-litigated in the
codebase already; preserve the comments that explain the constraint.

1. **Do NOT add `CATEGORY_HOME` to the default Player flavour.** It
   displaces OEM CMS launchers. Already documented in the manifest.
2. **Do NOT call API-31 symbols (`setRequireUserAction`,
   `USER_ACTION_NOT_REQUIRED`) directly from a class loaded on Android
   <12.** ART crashes with `VerifyError`. Always isolate behind
   `@RequiresApi(31) object Api31SilentInstall`.
3. **Do NOT regenerate the debug keystore on CI.** Different keys
   between builds = `INSTALL_FAILED_UPDATE_INCOMPATIBLE` for every
   operator. Use the committed `apps/player/app/debug.keystore`.
4. **Do NOT remove `LOCKED_BOOT_COMPLETED` from BootReceiver.** Some
   OEMs fire LOCKED before BOOT and our service won't start otherwise.
5. **Do NOT rely on system NTP without fallback.** TaurusOS clock has
   been observed to drift days because the GMS NTP service is stripped.
6. **Do NOT bundle a third-party WebView replacement (GeckoView)
   unless absolutely required.** APK size goes from 9.5MB → 80MB. Operator
   experience tanks.
7. **Do NOT hardcode the API URL anywhere.** We learned this with the
   Vercel routing failures. `BuildConfig.PLAYER_BASE_URL` is the only
   source of truth and must stay overridable at build time.

---

## Sources

### Android documentation (developer.android.com)

- [DevicePolicyManager](https://developer.android.com/reference/android/app/admin/DevicePolicyManager)
- [Lock task mode](https://developer.android.com/work/dpc/dedicated-devices/lock-task-mode)
- [Dedicated devices overview](https://developer.android.com/work/dpc/dedicated-devices)
- [What's in Android 9 for enterprise apps](https://developer.android.com/work/versions/android-9.0)
- [Foreground service types are required](https://developer.android.com/about/versions/14/changes/fgs-types-required)
- [Foreground service types reference](https://developer.android.com/develop/background-work/services/fgs/service-types)
- [User-Initiated Data Transfer](https://developer.android.com/develop/background-work/background-tasks/uidt)
- [Data transfer background task options](https://developer.android.com/develop/background-work/background-tasks/data-transfer-options)
- [Captive portal API support](https://developer.android.com/about/versions/11/features/captive-portal)
- [Optimize for Doze and App Standby](https://developer.android.com/training/monitoring-device-state/doze-standby)
- [Background optimization](https://developer.android.com/topic/performance/background-optimization)
- [Schedule alarms](https://developer.android.com/develop/background-work/services/alarms)
- [Task scheduling — persistent](https://developer.android.com/develop/background-work/background-tasks/persistent)
- [Long-running workers](https://developer.android.com/develop/background-work/background-tasks/persistent/how-to/long-running)
- [WebViewCompat reference](https://developer.android.com/reference/androidx/webkit/WebViewCompat)
- [WebViewClientCompat](https://developer.android.com/reference/androidx/webkit/WebViewClientCompat)
- [ServiceWorkerControllerCompat](https://developer.android.com/reference/androidx/webkit/ServiceWorkerControllerCompat)
- [androidx.webkit package](https://developer.android.com/reference/androidx/webkit/package-summary)
- [Jetpack Webkit overview](https://developer.android.com/develop/ui/views/layout/webapps/jetpack-webkit-overview)
- [PackageInstaller reference](https://developer.android.com/reference/android/content/pm/PackageInstaller)
- [PackageInstaller.Session reference](https://developer.android.com/reference/android/content/pm/PackageInstaller.Session)
- [Background Activity Launch restrictions](https://developer.android.com/guide/components/activities/background-starts)
- [WebView — unsafe file inclusion](https://developer.android.com/privacy-and-security/risks/webview-unsafe-file-inclusion)
- [Cross-app scripting](https://developer.android.com/privacy-and-security/risks/cross-app-scripting)
- [Request runtime permissions](https://developer.android.com/training/permissions/requesting)
- [Android Enterprise security](https://developer.android.com/work/dpc/security)

### Android Developers blog

- [Making it safer to get apps on Android O](https://android-developers.googleblog.com/2017/08/making-it-safer-to-get-apps-on-android-o.html)
- [Google Maps improved download reliability with UIDT](https://android-developers.googleblog.com/2024/09/google-maps-improved-download-reliability-user-initiated-data-transfer-api.html)
- [Android 14 Developer Preview 2](https://android-developers.googleblog.com/2023/03/android-14-developer-preview-2.html)

### Google Play

- [Use of REQUEST_INSTALL_PACKAGES](https://support.google.com/googleplay/android-developer/answer/12085295?hl=en)
- [Foreground service / full-screen intent requirements](https://support.google.com/googleplay/android-developer/answer/13392821?hl=en)

### AOSP source / docs

- [Provision for device management](https://source.android.com/docs/devices/admin/provision)
- [Test device management](https://source.android.com/docs/devices/admin/testing-setup)
- [Device management overview](https://source.android.com/docs/devices/admin)
- [Configure update ownership for apps](https://source.android.com/docs/setup/create/app-ownership)
- [Network time detection](https://source.android.com/docs/core/connect/time/network-time-detection)
- [Time source priority](https://source.android.com/docs/core/connect/time-source)
- [PackageInstaller.java source](https://android.googlesource.com/platform/frameworks/base/+/master/core/java/android/content/pm/PackageInstaller.java)
- [Captive portal detection](https://android.googlesource.com/platform/external/libwebsockets.git/+/refs/heads/main/READMEs/README.captive-portal-detection.md)

### Chromium / WebView

- [Web platform compatibility in Android WebView](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/web-platform-compatibility.md)
- [WebView for AOSP system integrators](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/aosp-system-integration.md)
- [WebView Providers](https://chromium.googlesource.com/chromium/src/+/HEAD/android_webview/docs/webview-providers.md)
- [WebView + Chrome 75 ServiceWorker fail](https://issues.chromium.org/issues/41467394)
- [Allow setting NTP server (issuetracker)](https://issuetracker.google.com/issues/243566041)

### Microsoft Learn (Xamarin / .NET Android — full API mirrors)

- [PackageInstaller class](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller)
- [SessionParams.SetRequireUserAction](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.setrequireuseraction)
- [SessionParams.UserActionNotRequired](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.useractionnotrequired)
- [SessionParams.UserActionRequired](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.useractionrequired)
- [SessionParams.SetRequestUpdateOwnership](https://learn.microsoft.com/en-us/dotnet/api/android.content.pm.packageinstaller.sessionparams.setrequestupdateownership)
- [DeviceAdminReceiver.ActionLockTaskEntering](https://learn.microsoft.com/en-us/dotnet/api/android.app.admin.deviceadminreceiver.actionlocktaskentering)
- [DevicePolicyManager.SetLockTaskPackages](https://learn.microsoft.com/en-us/dotnet/api/android.app.admin.devicepolicymanager.setlocktaskpackages)
- [Activity.StartLockTask](https://learn.microsoft.com/en-us/dotnet/api/android.app.activity.startlocktask)
- [WebViewClient.ShouldInterceptRequest](https://learn.microsoft.com/en-us/dotnet/api/android.webkit.webviewclient.shouldinterceptrequest)

### Industry blogs / dev.to / Medium

- [sisik — Update Android app silently](https://www.sisik.eu/blog/android/dev-admin/update-app)
- [dev.to — 11 layers I built to survive OEM background kills](https://dev.to/stoyan_minchev/what-android-oems-do-to-background-apps-and-the-11-layers-i-built-to-survive-it-28bb)
- [Medium — Android 14 UIDT replaces FGS](https://medium.com/@sivavishnu0705/android-14-s-secret-weapon-why-uidt-replaces-foreground-services-for-long-data-transfers-and-feff53e77812)
- [Medium — Android 14 FGS requirements](https://medium.com/gravel-engineering/why-android-14-s-foreground-service-requirements-might-break-your-app-and-how-to-fix-it-c1cbcf469b69)
- [Medium — Cody Brookshear: Creating an Android Device Owner app in 2023](https://medium.com/@codybrookshear/creating-an-android-device-owner-app-in-2023-b7e7b9fb3aca)
- [Medium — Long-running background work](https://chaitanyaduse.medium.com/navigating-the-maze-long-running-background-work-in-android-and-its-quirks-2a8e53442985)
- [ProAndroidDev — Battery optimization](https://proandroiddev.com/android-battery-optimization-for-avoiding-doze-mode-and-app-standby-83cd379ee75b)
- [ProAndroidDev — WorkManager StopReason](https://proandroiddev.com/why-has-my-background-worker-stopped-exploring-android-workmangers-stopreason-a0f743e6411c)
- [Florent Dupont — DPM shell command](http://florent-dupont.blogspot.com/2015/01/android-shell-command-dpm-device-policy.html)
- [42Gears tech blog — ADB Device Owner enrollment](https://techblogs.42gears.com/using-adb-for-speeding-up-the-device-owner-enrollment/)
- [emteria — Android 14 release](https://emteria.com/blog/android-14-release-date)
- [emteria — Android kiosk restrictions](https://emteria.com/blog/android-kiosk-restrictions)
- [emteria — AOSP Launcher](https://emteria.com/blog/aosp-launcher)
- [Wenchao Jiang — Making an Android Kiosk app](http://wenchaojiang.github.io/blog/realise-Android-kiosk-mode/)
- [Esper blog — Android 13 exact alarm restrictions](https://www.esper.io/blog/android-13-exact-alarm-api-restrictions)
- [Esper blog — Android provisioning options](https://www.esper.io/blog/android-provisioning-options-available-on-esper)
- [Esper Foundation product page](https://www.esper.io/products/esper-foundation)
- [Esper Device Provisioner help](https://help.esper.io/hc/en-us/articles/12311253854609-Esper-Device-Provisioner)
- [Esper provisioning template](https://help.esper.io/hc/en-us/articles/12625482751761-Creating-a-Provisioning-Template)

### Industry / dontkillmyapp / OEM-specific

- [dontkillmyapp.com main](https://dontkillmyapp.com/)
- [dontkillmyapp Stock Android](https://dontkillmyapp.com/stock_android)
- [dontkillmyapp Google](https://dontkillmyapp.com/google)
- [dontkillmyapp Samsung](https://dontkillmyapp.com/samsung)
- [dontkillmyapp Xiaomi](https://dontkillmyapp.com/xiaomi)
- [dontkillmyapp Vivo](https://dontkillmyapp.com/vivo)
- [dontkillmyapp Motorola](https://dontkillmyapp.com/motorola)
- [Hexnode — Android Lock Task Mode](https://www.hexnode.com/blogs/what-is-android-lock-task-mode/)
- [Hexnode — kiosk launcher setup](https://www.hexnode.com/mobile-device-management/help/how-to-set-up-kiosk-launcher-on-android-devices-with-hexnode/)
- [Hexnode — disable hardware buttons forum](https://www.hexnode.com/forums/topic/is-it-possible-to-disable-hardware-buttons-and-status-bar-in-android-kiosk-mode/)
- [Hexnode — hide status bar](https://www.hexnode.com/mobile-device-management/help/how-to-hide-status-bar-on-android-devices-using-hexnode-mdm/)
- [Hexnode — Android Enterprise QR enrollment](https://www.hexnode.com/mobile-device-management/help/how-to-enroll-devices-in-android-enterprise-using-qr-code/)
- [Hexnode — Knox Mobile Enrollment](https://www.hexnode.com/mobile-device-management/help/samsung-knox-mobile-enrollment/)
- [Hexnode vs Esper kiosk comparison](https://www.hexnode.com/blogs/hexnode-vs-esper-which-solution-offers-better-kiosk-management/)
- [Hexnode vs Scalefusion comparison](https://www.hexnode.com/blogs/hexnode-vs-scalefusion/)
- [Scalefusion vs Hexnode UEM guide](https://blog.scalefusion.com/scalefusion-vs-hexnode/)
- [Scalefusion — hide status bar](https://blog.scalefusion.com/hide-status-and-notification-bar-in-android/)
- [Scalefusion kiosk solution features](https://scalefusion.com/kiosk-solution/features)
- [ManageEngine MDM — silent install](https://www.manageengine.com/mobile-device-management/how-to/mdm-silent-installation-android-apps.html)
- [ManageEngine MDM — hide notification bar](https://www.manageengine.com/mobile-device-management/how-to/mdm-hide-notification-bar-on-android-devices.html)
- [Cubilock — customize Android launcher](https://blog.cubilock.com/customize-android-launcher-for-enterprises-devices-kiosk-mode/)
- [Miradore — custom launcher](https://www.miradore.com/knowledge/android/android-custom-launcher/)
- [Miradore — QR enrollment fully managed](https://www.miradore.com/knowledge/android/enroll-android-device-in-fully-managed-device-mode-using-qr-code/)
- [Miradore — kiosk policy](https://www.miradore.com/knowledge/android/android-custom-launcher/)
- [Inero — Android kiosk single-use](https://inero-software.com/android-kiosk-mode-how-to-turn-an-android-device-into-a-single-use-device/)
- [Headwind MDM — kiosk mode](https://h-mdm.com/kiosk-mode/)
- [Appaloosa — kiosk mode](https://www.appaloosa.io/blog/kiosk-mode)
- [TinyMDM — kiosk use cases](https://www.tinymdm.net/kiosk-mode-use-cases/)
- [airdroid — auto-launch app at boot](https://www.airdroid.com/app-management/android-auto-launch-app/)
- [airdroid — hide status bar](https://www.airdroid.com/mdm/hide-status-bar-android/)
- [Ezurio — Lock Task Mode reference](https://www.ezurio.com/documentation/introduction-to-android-lock-task-mode-kiosk-mode)
- [NoMid MDM — Why standard kiosk mode isn't enough](https://www.nomidmdm.com/en/blog/why-standard-kiosk-mode-isnt-enough-and-what-android-enterprise-delivers)
- [Codeproof — Android Zero-Touch Enrollment](https://www.codeproof.com/integrations/android-zero-touch-enrollment/)
- [Citrix XenMobile — Kiosk policy](https://docs.citrix.com/en-us/xenmobile/server/policies/kiosk-policy.html)
- [IBM MaaS360 — COSU Kiosk](https://www.ibm.com/docs/en/maas360?topic=device-cosu-corporate-owned-single-use-kiosk-mode)
- [Microsoft Intune — Android dedicated devices](https://learn.microsoft.com/en-us/intune/intune-service/enrollment/android-dedicated-devices-fully-managed-enroll)
- [Microsoft Intune — Android enrollment guide](https://learn.microsoft.com/en-us/intune/device-enrollment/android/guide)
- [Ivanti — Provisioning Android Enterprise](https://help.ivanti.com/mi/help/en_US/CORE/11.x/dmga/DMGfiles/Provisioning_an_Android_.htm)

### Signage CMS — Xibo, OnSign, Yodeck, OptiSigns

- [Xibo Open Source Players (GitHub org)](https://github.com/xibo-players)
- [Xibo digital signage](https://github.com/xibosignage/xibo)
- [Xibo CMS](https://github.com/xibosignage/xibo-cms)
- [Xibo Player downloads](https://www.xiboplayer.org/downloads/)
- [Xibo for Android](https://xibosignage.com/xibo-for-android)
- [Xibo signage downloads](https://xibosignage.com/downloads)
- [OnSign — Android](https://docs.onsign.com/android)
- [OnSign — NovaStar Taurus deployment guide](https://docs.onsign.com/android/novastar-taurus-android)
- [Yodeck — Android via APK setup](https://www.yodeck.com/docs/creating-a-yodeck-player/setting-up-an-android-player-with-the-yodeck-software-via-apk/)
- [Yodeck — APK setup user manual](https://www.yodeck.com/docs/user-manual/setting-up-an-android-player-with-the-yodeck-software-via-apk-2/)
- [Yodeck — BrightSign player setup](https://www.yodeck.com/docs/creating-a-yodeck-player/creating-a-yodeck-player-based-on-brightsign/)
- [OptiSigns — Android signage device guide](https://www.optisigns.com/post/using-an-android-device-for-digital-signage)

### Hardware-specific (NovaStar Taurus / Rockchip)

- [NovaStar Taurus TB60 product page](https://www.sinaplug.com/products/novastar-taurus-tb60-multimedia-player)
- [NovaStar TB60 wireless player](https://www.leemanled.com/novastar-tb60-wireless-led-multimedia-player-controller/)
- [VNNOX cloud download](https://en.vnnox.com/download)
- [ViPlex Handy User Manual (PDF)](https://oss.novastar.tech/uploads/2022/03/ViPlex-Handy-Media-Player-Control-App-User-Manual-V4.4.0.pdf)
- [Gateworks Android kiosk](https://trac.gateworks.com/wiki/Android/Kiosk)
- [Digi ConnectCore — autostart custom app](https://docs.digi.com/resources/documentation/digidocs/embedded/android/oreo/cc6/android_t_faq-autostart-custom-apps)
- [Digi ConnectCore 8X — autostart](https://docs.digi.com/resources/documentation/digidocs/embedded/android/pie/cc8x/android_t_autostart-apps)
- [Zebra Technologies — TLS/SSL Compliance](https://techdocs.zebra.com/enterprise-browser/2-0/guide/compliance/)

### NTP libraries

- [Kronos-Android (Lyft)](https://github.com/lyft/Kronos-Android)
- [TrueTime-Android (Instacart)](https://github.com/instacart/truetime-android)
- [NTPSync (Free Software for Android)](https://github.com/Free-Software-for-Android/NTPSync)
- [MuTime](https://github.com/medavox/MuTime)
- [Set NTP server gist](https://gist.github.com/xujiaao/63cb3bbea9fe22e79206e5eb7ba82d0e)
- [UTC time on Android with NTP](https://www.prasanna.dev/posts/utc-time-android-device-ntp-server-sync)

### Open-source kiosk references

- [TestDPC (Google)](https://github.com/googlesamples/android-testdpc)
- [TestDPC issue 2 — non-NFC provisioning](https://github.com/googlesamples/android-testdpc/issues/2)
- [TestDPC issue 29 — set status bar icons](https://github.com/googlesamples/android-testdpc/issues/29)
- [TestDPC issue 99 — QR provisioning error](https://github.com/googlesamples/android-testdpc/issues/99)
- [bayuwijdev — Sample Device Owner](https://github.com/bayuwijdev/Sample-Device-Owner-android-app)
- [mrugacz95/kiosk](https://github.com/mrugacz95/kiosk)
- [innovation-system/android-kiosk](https://github.com/innovation-system/android-kiosk)
- [nktnet1/webview-kiosk](https://github.com/nktnet1/webview-kiosk)
- [isurusen/kiosk-android](https://github.com/isurusen/kiosk-android)
- [osamaalek/Kiosk-Launcher](https://github.com/osamaalek/Kiosk-Launcher)
- [karlcc/Kiosk-Launcher](https://github.com/karlcc/Kiosk-Launcher)
- [exraaaa/KioskZen — GeckoView kiosk](https://github.com/exraaaa/KioskZen)
- [RushB-fr/freekiosk](https://github.com/RushB-fr/freekiosk)
- [PerfsolTech/Android-AutoStart-App](https://github.com/PerfsolTech/Android-AutoStart-App)
- [yashodhank/youplugyDS — open Xibo player](https://github.com/yashodhank/youplugyDS)
- [vvb2060/PackageInstaller](https://github.com/vvb2060/PackageInstaller)
- [vvb2060/PackageInstallerTest](https://github.com/vvb2060/PackageInstallerTest)
- [gaoyan10/android-silent-installer](https://github.com/gaoyan10/android-silent-installer)
- [thomas550i/cordova-plugin-doze-Optimize](https://github.com/thomas550i/cordova-plugin-doze-Optimize)
- [squareetlabs/capacitor-dont-kill-my-app](https://github.com/squareetlabs/capacitor-dont-kill-my-app)
- [Fuzion24 — install/remove APK gist](https://gist.github.com/Fuzion24/2623253)
- [bashenk — QR code for Android Device Enrollment gist](https://gist.github.com/bashenk/58c6dd883b177ee6e6ed1c533f3e8066)
- [oasisfeng/island — silent install commit](https://github.com/oasisfeng/island/commit/3e1bacb56008d902c37b84d3f647763ed5aca792)

### Issues and forum threads

- [Microsoft appcenter-sdk-android #1615 — auto-update](https://github.com/microsoft/appcenter-sdk-android/issues/1615)
- [NeoApplications/Neo-Store #20 — auto update Android 12](https://github.com/NeoApplications/Neo-Store/issues/20)
- [google/ExoPlayer #11239 — FGS types Android 14](https://github.com/google/ExoPlayer/issues/11239)
- [issuetracker.google.com/issues/279516894 — Android 14 FGS impact](https://issuetracker.google.com/issues/279516894)
- [Android Enterprise community — Device Owner Provisioning](https://www.androidenterprise.community/discussions/conversations/device-owner-provisioning/12237)
- [Android Enterprise community — QR Code APK requirements](https://www.androidenterprise.community/discussions/conversations/qr-code-apk-requirements/3332)
- [Android Enterprise community — QR Code provisioning](https://www.androidenterprise.community/android-enterprise-general-discussions-3/qr-code-provisioning-699)
- [B4X — Programmatically installing APK with API 24+](https://www.b4x.com/android/forum/threads/programmatically-installing-an-apk-using-api-24-or-higher.88184/)
- [B4X — WorkManager / AlarmManager / JobScheduler reliability](https://www.b4x.com/android/forum/threads/workmanager-alarmmanager-jobscheduler-jobintentservice-which-is-reliable.115611/)
- [B4X — kiosk auto-start after reboot](https://www.b4x.com/android/forum/threads/kiosk-auto-start-just-after-reboot.104806/)
- [XDA Forums — unable to set device owner SOLVED](https://xdaforums.com/t/unable-to-set-device-owner-solved.4513841/)
- [XDA Forums — captive portal checkin guide](https://xdaforums.com/t/guide-how-to-avoid-the-captive-portal-checkin-to-google.3927561/)
- [XDA — MIUI battery optimization whitelist guide](https://xdaforums.com/t/guide-miui-battery-optimization-whitelist-miui-12.4388749/)
- [Issuetracker — INSTALL_PACKAGE FileProvider 37034874](https://issuetracker.google.com/issues/37034874)
- [Issuetracker — Set NTP server 243566041](https://issuetracker.google.com/issues/243566041)
- [Issuetracker — Auto-set time NITZ 36930949](https://issuetracker.google.com/issues/36930949)

### Security and copyright references

- [WebView security best practices (Medium)](https://medium.com/@kliment.jonceski/secure-android-webviews-best-practices-f110af9aba0c)
- [Oversecured WebView checklist](https://blog.oversecured.com/Android-security-checklist-webview/)
- [Securing.pl WebView issues](https://www.securing.pl/en/webview-security-issues-in-android-applications/)
- [DZone — Android WebView secure coding](https://dzone.com/articles/android-webview-secure-coding-practices)
- [SEI CMU — DRD02-J WebView](https://wiki.sei.cmu.edu/confluence/display/android/DRD02-J.+Do+not+allow+WebView+to+access+sensitive+local+resource+through+file+scheme)
- [CodeQL — APK installation query help](https://codeql.github.com/codeql-query-help/java/java-android-arbitrary-apk-installation/)
- [CodeQL — Android WebSettings file access](https://codeql.github.com/codeql-query-help/java/java-android-websettings-file-access/)

---

*This document is a living reference. When you discover a new pattern,
hit a new bug, or change an Android API behaviour, append the section
and add the source URL.*
