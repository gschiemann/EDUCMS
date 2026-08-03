# VERIFIED CRITICAL — Production player + manager APKs are debug-signed with a public key, and are debuggable

**Date:** 2026-08-01
**Status:** CONFIRMED by the lead (not an agent claim). Two independent verification methods each.
**Verified against:** working tree at `cca5aa78` (master)

> This file is the durable record of the one finding that was fully verified before the
> broader audit fleet was stopped for budget. Everything below is traceable to a file:line
> or a real build artifact that was read directly.

---

## Finding PLAYER-SIGN-01 — the APK signing key is committed to a public repo

**Severity: CRITICAL.** **Attacker profile:** anyone on the internet (to obtain the key);
physical/ADB access or OTA-path control (to use it).

### Evidence — method 1: the key is tracked in git

```
$ git ls-files | grep -iE "keystore"
apps/player/app/debug.keystore
apps/player/generate-debug-keystore.py
```

The repo is **public** (`github.com/gschiemann/EDUCMS`, per CLAUDE.md §5), so the private key
is world-readable. It is committed **deliberately** — `apps/player/.gitignore` force-includes it:

```
*.keystore
*.jks
# Stable debug keystore (committed intentionally — see comment in build.gradle.kts).
!app/debug.keystore
```

The passwords are hardcoded in plaintext next to it, in
`apps/player/app/build.gradle.kts`:

```kotlin
signingConfigs {
    getByName("debug") {
        storeFile = file("debug.keystore")
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
}
```

`apps/player/manager/build.gradle.kts` reuses **the same key file**:

```kotlin
signingConfigs {
    getByName("debug") {
        storeFile = file("../app/debug.keystore")
        storePassword = "android"
        keyAlias = "androiddebugkey"
        keyPassword = "android"
    }
}
```

### Evidence — method 2: that key signs the artifact you actually ship

`.github/workflows/android-player-apk.yml`:

- Job name: `Build debug APK`
- Build step: `./gradlew --no-daemon --stacktrace assembleDebug -PplayerBaseUrl="$PLAYER_BASE_URL"`
- The **debug** output is then renamed to the production filename and published:
  ```
  APK=$(find apps/player/app/build/outputs/apk/debug -name '*universal*.apk' | head -1)
  NEW_NAME="edu-cms-player-v${VERSION}.apk"
  ```
- On a `player-v*` tag it is attached to a **public GitHub Release** via
  `softprops/action-gh-release@v2`, and the workflow's own comment states that
  `/api/v1/player/apk/latest` resolves to that release asset.
- The same job publishes `edu-cms-manager-v${MVERSION}.apk` from
  `apps/player/manager/build/outputs/apk/debug`.

The `release` build type in **both** modules declares no `signingConfig` at all, so it produces
an unsigned APK and is never what reaches a screen. **`assembleRelease` is not invoked anywhere
in CI.**

### What this does and does not enable

**Does:**
1. Android's same-signature upgrade check is the primary control proving an APK update is
   genuinely yours. A public private key defeats it — an attacker-built APK installs cleanly
   as an **update over the real player**, inheriting its data directory and identity.
2. Manager declares `com.educms.manager.HEALTH_PERMISSION` at `signature` protection level.
   Any attacker APK signed with this key satisfies it.
3. Where Manager holds **DEVICE_OWNER** — which `docs/MANAGER_PROVISIONING.md` and the release
   notes instruct operators to do so OTA is silent — a same-signed malicious update inherits
   device-owner power over the kiosk.

**Does not (on its own):** grant remote code execution from the internet. The attacker still
needs a delivery path — physical/ADB access to the device, or control of the OTA download URL
or the GitHub Release. It removes the cryptographic barrier; it does not by itself provide
delivery.

### Fix

Generate a real release keystore, store it **outside the repo** as a GitHub Actions secret
(base64), add a `release` `signingConfig` to both modules reading from env, and switch CI to
`assembleRelease`. Rotate by publishing a new signed build — note that changing the signing key
means existing installs **cannot** be updated over the air and will need a manual reinstall, so
plan the cutover deliberately. Delete `app/debug.keystore` and
`apps/player/generate-debug-keystore.py` from the repo and purge from history.

---

## Finding PLAYER-SIGN-02 — the shipped APKs are `android:debuggable="true"`

**Severity: CRITICAL.** **Attacker profile:** physical access to a screen, or ADB reachable
on the school network.

### Evidence — method 1: no override exists in the Gradle config

```
$ grep -rn "isDebuggable\|debuggable" apps/player --include="*.kts" --include="*.xml" | grep -v "/build/"
(no matches — exit 1)
```

There is no `isDebuggable = false` anywhere, so AGP's default for the `debug` build type
(`debuggable = true`) stands. Since CI ships the debug build (PLAYER-SIGN-01), that default
reaches production.

### Evidence — method 2: read directly from the real merged build artifacts

`apps/player/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml`:
```
android:debuggable="true"
package="com.educms.player.debug"
android:versionName="1.0.57-TEST-debug"
```

`apps/player/manager/build/intermediates/merged_manifests/debug/processDebugManifest/universal/AndroidManifest.xml`:
```
android:debuggable="true"
package="com.educms.manager.debug"
```

### Impact

`android:debuggable="true"` means that on any device where ADB is reachable — a USB port on a
hallway screen, or `adb tcpip` on school wifi:

- `adb shell run-as com.educms.player.debug` opens a shell **inside the app's private data
  directory with no root required** — the device token in `DeviceStore`, the DataStore prefs,
  and the offline content cache are all readable and writable.
- A debugger can attach over JDWP, giving **arbitrary code execution inside the app process**.
- WebView contents become inspectable regardless of `setWebContentsDebuggingEnabled`.

Stealing one device token is the entry point for the whole device-token dimension of the audit
(replay, scope, revocation) — this finding is what makes that theft cheap.

### Fix

Ship `assembleRelease` (see PLAYER-SIGN-01). As a belt-and-suspenders measure, set
`isDebuggable = false` explicitly on any build type that could ever be published, and add a CI
assertion that greps the merged manifest of the published artifact for
`android:debuggable="true"` and fails the build.

### Note on the package suffix

The published APK's applicationId is `com.educms.player.debug` (from
`applicationIdSuffix = ".debug"`), but Manager pins
`buildConfigField("String", "PLAYER_PACKAGE", "\"com.educms.player\"")` — no `.debug` suffix.
That pin is described in `manager/build.gradle.kts` as the defense that stops Manager installing
a swapped APK via its DEVICE_OWNER privileges. **UNVERIFIED:** whether that check is effective
in production given the suffix mismatch, or whether it is silently never matching. This needs
tracing through `OtaInstaller`/`OtaWorker` — it was queued for the OTA audit dimension that did
not complete.

---

## Cross-reference

Both findings feed the OTA dimension (`docs/.../02-*` when the audit resumes): the OTA chain's
real integrity guarantee depends on APK signature authenticity, which PLAYER-SIGN-01 nullifies.
