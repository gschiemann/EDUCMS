# Player / Manager release signing — cutover runbook

> **Status (2026-08-03): EXECUTED THROUGH STEP 7 for the Player.**
> `player-v1.1.0` is published, release-signed (CN=VenueOS), not
> debuggable, with the `ALLOW_DEBUGGABLE_RELEASE` escape hatch deleted
> and the unsigned-artifact guards live in CI.
>
> | Step | State |
> |---|---|
> | 1–3 Keystore generated, backed up, loaded as Actions secrets | ✅ done |
> | 4 Workflow builds `assembleRelease`, escape hatch deleted | ✅ done |
> | 5 Bundled-Manager variant trap | ✅ **fixed in gradle 2026-08-03** — but v1.1.0 itself shipped with a DEBUG-signed bundled Manager. **Tag v1.1.1 (and manager-v1.1.0) and use THOSE for the reinstall tour, not v1.1.0.** |
> | 6 R8/ProGuard field smoke on a real kiosk + Taurus | ⬜ open — do before the tour |
> | 7 Publish-time verification | ✅ done for v1.1.0 |
> | 8 Roll the fleet (hands-on reinstall) | ⬜ open — the dashboard's "Hands-on reinstall required" chip on each `-debug` screen is the live checklist |
> | 9 Retire the old key + history purge | ⬜ open — after the tour |
>
> **Server-side state (2026-08-03):** the OTA endpoints refuse to offer
> v1.1.0+ to `-debug` callers (`needsManualReinstall`), the anti-rollback
> floor is `1.1.0` (the compromised-debug-key era can never be advertised
> again), and per-release SHA pins are captured with
> `scripts/pin-apk-sha.sh` after each tag.
>
> **⚠️ Rollback is degraded post-cutover — a conscious trade.** Manager's
> on-device `RollbackInstaller` relied on debug builds permitting
> downgrade installs; release-signed builds refuse downgrades without
> device-owner. From v1.1.0 on, the recall path for a bad build is
> server-side: quarantine it (`PLAYER_APK_QUARANTINE` /
> `QUARANTINED_PLAYER_VERSIONS`) and ship a HIGHER fixed version. True
> on-device rollback returns with device-owner provisioning (Phase C).

---

## ⚠️ READ THIS FIRST — the fleet consequence

**Cutting over forces a MANUAL REINSTALL of every screen already in the
field. Over-the-air update will NOT carry them across.**

Two independent reasons, either one sufficient:

1. **The signing key changes.** Android refuses to install an upgrade
   signed with a different key than the installed copy —
   `INSTALL_FAILED_UPDATE_INCOMPATIBLE`. There is no override, no
   "force update", no server-side flag. This is enforced by the OS.
2. **The package name changes.** The `debug` build type applies
   `applicationIdSuffix = ".debug"`, so every deployed screen today is
   running package **`com.educms.player.debug`**, version name
   **`1.0.74-debug`** (verified against the published
   `venue-os-player-vc10074.apk`). A release build is
   `com.educms.player` — to Android that is a *different application*.
   It installs **side by side**; it does not replace anything.

Practical consequences to plan for:

- Someone must physically touch every kiosk (or reach it over ADB).
- Pairing tokens are lost. `Settings.Secure.ANDROID_ID` is scoped per
  (signing key + package + user) on Android 8+, so the new install is a
  new device identity and must be re-paired.
- The old `com.educms.player.debug` app must be uninstalled explicitly,
  or both copies sit on the device and can both try to be HOME.
- Device Owner provisioning (`dpm set-device-owner`) is tied to the
  Manager package; re-check `docs/MANAGER_PROVISIONING.md` before you
  touch Manager's application id.

**Schedule this deliberately** — ideally folded into a physical
maintenance window, a hardware refresh, or a summer break, when someone
is already visiting the screens. Do not do it on a Friday, and do not do
it the week before an event.

---

## Why it needs doing anyway

The artifact we publish today is a **debug build**:

- `.github/workflows/android-player-apk.yml` runs `assembleDebug`,
  renames the output to `edu-cms-player-v<VERSION>.apk`, and attaches it
  to a **public** GitHub Release. `/api/v1/player/apk/latest` resolves to
  that asset. The `release` build type has never been built.
- The merged manifest therefore carries `android:debuggable="true"`
  (verified with `aapt2` on the real published APK, and by
  `scripts/check-apk-debuggable.cjs`). Anyone with ADB access to a kiosk
  can attach a debugger, read the app's data directory, and drive the
  process.
- `apps/player/app/debug.keystore` is **committed to a public repo**,
  with its passwords hardcoded in `app/build.gradle.kts`
  (`storePassword = "android"`, alias `androiddebugkey`). The file is a
  PKCS#12 container, but the password that opens it is published two
  files away — so anyone who clones the repo can sign an APK that
  Android accepts as a legitimate update to our player.

These screens run life-safety lockdown, weather and evacuation alerts.

---

## What is already in place (you do not need to build this)

| Piece | Where | State |
|---|---|---|
| Env/property-driven `release` signingConfig | `app/build.gradle.kts`, `manager/build.gradle.kts` | Built. Inert until the four values are supplied. |
| `isDebuggable = false` on `release` | both modules | Set explicitly. |
| Published-artifact debuggable gate | `scripts/check-apk-debuggable.cjs`, wired into `android-player-apk.yml` | **Live**, currently suppressed by one env line. |
| New-keystore gate | `scripts/check-tracked-keystores.cjs`, `.github/workflows/signing-secrets.yml` | **Live and blocking.** |
| `app/proguard-rules.pro` | `apps/player/app/` | Newly created, **never built** — see step 6. |

The release signing config degrades gracefully: if the four values are
absent, the config is simply not created, `assembleDebug` is untouched,
and `assembleRelease` produces an unsigned APK rather than failing.

---

## The cutover

### Step 1 — Generate the release keystore (you run this, not an agent)

On a trusted machine, **not** in the repo directory:

```bash
keytool -genkeypair -v \
  -keystore venueos-release.jks \
  -storetype PKCS12 \
  -alias venueos-player \
  -keyalg RSA -keysize 4096 \
  -validity 10950 \
  -dname "CN=VenueOS, OU=Player, O=VenueOS, L=, ST=, C=US"
```

- `-validity 10950` is 30 years. **Do not use a short validity.** Once
  the certificate expires you cannot ship updates, and the only recovery
  is another full fleet reinstall.
- Use a long random passphrase for both the store and the key. Put it in
  a password manager **now**, before you continue.
- 4096-bit RSA: this key must outlive the hardware.

### Step 2 — Back it up before you use it

Losing this file costs exactly the same fleet-wide reinstall as rotating
it. Treat it like a root credential:

- Password manager (as an attachment) **and** an offline encrypted copy.
- At least two people / two locations.
- Never in the repo. `apps/player/.gitignore` already ignores `*.jks`,
  `*.keystore`, `*.p12`, `*.pfx`, `*.bks`, and
  `scripts/check-tracked-keystores.cjs` fails CI if one is ever tracked.

### Step 3 — Load it into GitHub Actions

```bash
base64 -i venueos-release.jks | pbcopy      # macOS
# base64 -w0 venueos-release.jks            # Linux
```

In **Settings → Secrets and variables → Actions**, create:

| Secret | Value |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | the base64 blob from above |
| `RELEASE_STORE_PASSWORD` | store passphrase |
| `RELEASE_KEY_ALIAS` | `venueos-player` |
| `RELEASE_KEY_PASSWORD` | key passphrase |

### Step 4 — Wire the workflow

In `.github/workflows/android-player-apk.yml`:

**4a.** Decode the keystore before the build step:

```yaml
      - name: Decode release keystore
        run: |
          echo "${{ secrets.RELEASE_KEYSTORE_BASE64 }}" | base64 -d > apps/player/release.jks
```

**4b.** Build release instead of debug, passing the four values. A
*relative* `RELEASE_STORE_FILE` resolves against the Gradle **root**
project (`apps/player/`) in both modules, so one value serves both:

```yaml
      - name: Build release APK
        env:
          PLAYER_BASE_URL: ...          # unchanged
          RELEASE_STORE_FILE: release.jks
          RELEASE_STORE_PASSWORD: ${{ secrets.RELEASE_STORE_PASSWORD }}
          RELEASE_KEY_ALIAS: ${{ secrets.RELEASE_KEY_ALIAS }}
          RELEASE_KEY_PASSWORD: ${{ secrets.RELEASE_KEY_PASSWORD }}
        run: |
          cd apps/player
          ./gradlew --no-daemon --stacktrace assembleRelease -PplayerBaseUrl="$PLAYER_BASE_URL" ...
```

**4c.** Point the two `Locate + version-rename …` steps at the release
output directory. They currently hardcode `debug`:

- `apps/player/app/build/outputs/apk/debug` → `.../release`
- `apps/player/manager/build/outputs/apk/debug` → `.../release`

Release artifacts are named `app-universal-release.apk`. If signing did
not engage you will get `app-universal-release-unsigned.apk` instead —
treat that filename as a hard failure, not something to rename past.

**4d. Delete the escape hatch.** In the step
`Guard — published APK must not be debuggable`, delete these two lines:

```yaml
        env:
          ALLOW_DEBUGGABLE_RELEASE: '1' # TODO(cutover): delete — see apps/player/RELEASE_SIGNING.md
```

**This is the line that completes the fix.** Until it is gone, the gate
reports the violation but lets the release through.

### Step 5 — Fix the bundled-Manager variant trap ✅ (gradle fixed 2026-08-03; verify on v1.1.1)

`app/build.gradle.kts`'s `bundleManagerApk` task was hardcoded to
`:manager:assembleDebug` — so **v1.1.0 shipped with a DEBUG-signed
Manager at `assets/bundled/edu-cms-manager.apk`** (verified by
unzipping the published release asset). Mixed signing identities in one
artifact, and a bundled Manager the release-signed era can't update.

Fixed: the task now keys off the same four release-signing values the
signingConfig uses — release builds bundle `:manager:assembleRelease`
output, debug builds are byte-for-byte unchanged. An `-unsigned` release
output (signing didn't engage) is excluded, and a companion
`verifyBundledManagerApk` task hard-fails the build if no bundled
Manager lands (a plain `doLast` on the Copy would be skipped as
NO-SOURCE in exactly that case).

**Remaining verification:** the release path first runs on the next tag.
On v1.1.1, download the release asset and confirm the bundle:

```bash
unzip -p edu-cms-player-v1.1.1.apk assets/bundled/edu-cms-manager.apk > /tmp/bundled-mgr.apk
keytool -printcert -jarfile /tmp/bundled-mgr.apk   # must show CN=VenueOS, not androiddebugkey
```

### Step 6 — Smoke-test minification (this is where it will break)

The `release` build type sets `isMinifyEnabled = true` and
`isShrinkResources = true`, and neither has **ever** been exercised.

`app/proguard-rules.pro` did not exist until this work added it — the
`proguardFiles(...)` line referenced a missing file because the release
variant was never built. The rules it now contains (keeps for
`WebAppBridge`, the `@JavascriptInterface` surface, the CTS serial
bridge, WorkManager workers) are **written but unverified**.

R8 stripping a `@JavascriptInterface` method does not crash — the
JavaScript call just silently resolves to `undefined` and the web layer
goes quietly dead. You will not catch this from a build log.

Before shipping:

- Build `assembleRelease` locally.
- Install on a real kiosk (and a real NovaStar Taurus, not only a phone).
- Exercise: pairing, playlist playback, **an emergency trigger and
  all-clear**, OTA self-update, USB ingest, and the CTS/serial bridge if
  that venue uses it.
- If anything is dead, add the missing `-keep` rule. Do **not** "fix" it
  by setting `isMinifyEnabled = false` without saying so out loud.

### Step 7 — Verify before you publish

```bash
# Should print nothing (no debuggable attribute at all).
aapt2 dump xmltree --file AndroidManifest.xml <the-release>.apk | grep -i debuggable

# Package must be com.educms.player, NOT com.educms.player.debug.
aapt2 dump packagename <the-release>.apk

# Signed by the new key, not the old one.
keytool -printcert -jarfile <the-release>.apk

# The gate itself, with no escape hatch:
node scripts/check-apk-debuggable.cjs <the-release>.apk   # must exit 0
```

### Step 8 — Roll the fleet

Plan the physical pass. For each screen: install the new APK, re-pair,
uninstall `com.educms.player.debug`, and confirm Device Owner /
HOME-alias behaviour still holds (`docs/MANAGER_PROVISIONING.md`).

Manager already tolerates both package ids — `OtaWorker`, `ManagerApp`,
`OtaInstaller` and `RollbackInstaller` all probe
`listOf(BuildConfig.PLAYER_PACKAGE, "${BuildConfig.PLAYER_PACKAGE}.debug")`
— so Manager will not be confused during a mixed-fleet period. That
buys you a staged rollout; it does **not** remove the need to visit
each screen.

### Step 9 — Retire the old key

Only once the whole fleet is on the new key:

1. `git rm apps/player/app/debug.keystore`
2. Remove the `!app/debug.keystore` negation from `apps/player/.gitignore`.
3. Remove the hardcoded `debug` signingConfig blocks from both
   `build.gradle.kts` files (let AGP generate a throwaway local debug key
   again — its only purpose was stable OTA signing, which the release key
   now provides).
4. Delete the `apps/player/app/debug.keystore` entry from `EXCEPTIONS` in
   `scripts/check-tracked-keystores.cjs`. The guard warns about a stale
   exception, so CI will remind you.
5. Purge it from git history:

   ```bash
   pip install git-filter-repo
   git filter-repo --path apps/player/app/debug.keystore --invert-paths
   git push --force --all && git push --force --tags
   ```

   Coordinate first: this rewrites every commit hash. Everyone must
   re-clone. Forks and existing clones keep the old objects regardless.

**The old key is permanently compromised.** It sat in a public repo with
its password in an adjacent file; assume it has been copied. History
purging reduces discoverability, not exposure. Never reuse it, never
"un-retire" it, and do not treat the purge as making the old artifacts
safe — every APK ever attached to a public GitHub Release stays
downloadable and debuggable.

---

## If you only do one thing

Steps 1–4 remove `android:debuggable="true"` and move signing to a key
that is not published. Step 9 is cleanup and can follow later. Step 5
and Step 6 are the ones that will actually bite you — do not skip them
because the build went green.
