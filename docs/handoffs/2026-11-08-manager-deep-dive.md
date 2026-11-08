# 2026-11-08 — The companion Manager: deep dive and the one-release-unit design

Decision format. Written by Fable 5.1 for the Lead; owner's intent: *"shouldn't it be wrapped up in the same APK as the player and follow the exact same upgrade steps, and if the version isn't newer it just only upgrades the piece that is — make it work right and make it the best in the CMS business."* The repository is public: no customer names, no secrets, counts only.

## Situation

The Android Player (`apps/player/app`, `com.educms.player`) ships with a companion **Manager** (`apps/player/manager`, `com.educms.manager`): a second package that watches the Player's heartbeat and relaunches it, bootstraps a Player onto an empty kiosk, and used to update itself. The Manager is **1.0.24 / versionCode 10024**, hand-typed in `apps/player/manager/build.gradle.kts`; its last tag `manager-v1.0.24` was cut 2026-09-01. The Player is 1.1.29 stable with field candidates up to 1.1.65-field.1. Two Manager fixes have sat unreleased on master since October (a5c820ba7, 565dd5b68).

The Manager has had **two update paths** and both were wrong:

1. **Self-update** (`ManagerSelfUpdateWorker.kt` → `POST /api/v1/player/manager-update-check`, every 30 min): the API resolved the newest `manager-v*` GitHub release and offered it to every Manager that asked (`player-ota.controller.ts`, `managerUpdateCheck` and `resolveLatestManagerReleaseInfo`). Publishing a Manager tag was therefore a **fleet-wide push within ~30 minutes** — no field window, no tracked push, no canary, no hardware class, no off-hours. CLAUDE.md §7 and `fleet-push-policy.ts` forbid exactly that for the Player; the Manager simply was not covered.
2. **Bundled upgrade** — the correct path, already built and dormant: every Player APK carries the Manager APK in its assets (`apps/player/app/build.gradle.kts`, `bundleManagerApk` / `verifyBundledManagerApk`), and on boot or `CHECK_FOR_UPDATES` the Player compares the bundled versionCode with the installed one and, only when newer, holds content, installs it and resumes (`bootstrap/ManagerBootstrap.kt` `probeUpgrade` / `bootstrapInternal`, `ManagerUpgradeMath.decide` → `HOLD_AND_UPGRADE`; `MainActivity.kt` `evaluateManagerUpgradeHold`). Because the Manager version never moved after 2026-09-01, every Player since then bundled the same 1.0.24 and this path had nothing to install.

So the owner's design — one APK, same upgrade steps, only the newer piece installs — **already exists in the Player**; what was missing is a version line that moves, a release unit that includes the Manager, and the retirement of the side door.

## Evidence

### 1. What the Manager does today (file by file)

| Component | File | What it does | Notes |
|---|---|---|---|
| Application | `apps/player/manager/src/main/java/com/educms/manager/ManagerApp.kt` | On create: installs the crash handler, starts `WatchdogService`, posts the install-permission notification when not device owner, schedules the Player lane (`OtaWorker`, 30 min) and — until this change — the self-update lane (30 min) and fires both once; `pinPlayerAsHome` / `allowPlayerLockTask` run only as device owner | VenueOS is never the device owner (owner decision 2026-10-17), so the HOME pin and lock-task grant are dead code on the whole fleet |
| Watchdog | `WatchdogService.kt` | Foreground service (`dataSync`), ticks every 30 s on the main looper, reads the heartbeat row; stale ≥ 90 s for 3 ticks → `forceRestartPlayer()` via the launch intent (API 34: `Api34BalLauncher`); post-install grace window 5 min, then `promoteToGood` or `RollbackInstaller.rollback` | `START_STICKY`; no telemetry of a restart or a rollback leaves the device |
| Heartbeat channel | `PlayerHealthProvider.kt` | ContentProvider `com.educms.manager.health/heartbeat`, signature-protected `HEALTH_PERMISSION`; Player inserts `timestamp_ms`, `version_name`, `pid`, `device_fingerprint` every 30 s; persisted to prefs so a Manager restart does not read "dead" | The Player side is `heartbeat/ManagerHeartbeatPublisher.kt` (own HandlerThread) |
| Boot | `BootReceiver.kt` | `BOOT_COMPLETED`, `LOCKED_BOOT_COMPLETED`, two QUICKBOOT variants → start the watchdog, fire the lanes | Fires on every t982 nightly reboot |
| Package events | `PackageReplacedReceiver.kt` | `MY_PACKAGE_REPLACED` → clear in-flight marker, restart watchdog, reschedule; `PACKAGE_REPLACED` of the Player → relaunch with 6 × 1 s retries | |
| Trigger from the Player | `OtaTriggerReceiver.kt` | `com.educms.manager.TRIGGER_OTA_CHECK` (signature permission), sent by `PlayerApp.fireOtaCheckNow` → enqueue the Player lane | |
| Player lane | `OtaWorker.kt` | Since 565dd5b68 (unreleased): returns before any network call once a Player is installed; only the **bootstrap** (no Player on the kiosk, vc=0) still calls `/update-check` with `source=manager` and installs the first Player | The API refuses the non-bootstrap Manager check too (`manager-check-player-installs-itself`) |
| Self-update lane | `ManagerSelfUpdateWorker.kt` | `/manager-update-check` → download → SHA-256 (fail-closed since a5c820ba7, unreleased) → `OtaInstaller.installApk` on itself | **Retired by this change** |
| Installer | `OtaInstaller.kt`, `Api31SilentInstall.kt`, `Api34UpdateOwnership.kt` | `PackageInstaller` session pinned to the APK's package id; `USER_ACTION_NOT_REQUIRED` on API 31+; update-ownership request on 34+ | Silent only when the Manager is installer of record of the target — it never is for a sideloaded Player |
| Install result | `OtaInstallReceiver.kt`, `InstallPromptActivity.kt` | `STATUS_PENDING_USER_ACTION` → full-screen-intent notification → transparent trampoline → system Install dialog; `STATUS_SUCCESS` → relaunch | The notification copy is English-only, branded "EduCMS" |
| Markers | `InstallTracker.kt` | In-flight self-install marker, stale after 4 h | |
| Rollback | `rollback/InstallState.kt`, `ApkArchive.kt`, `QuarantineList.kt`, `RollbackInstaller.kt` | Archives the current Player APK before an install (keeps 2), quarantines a versionCode that failed first boot, reinstalls the archived APK | On a release-signed, non-device-owner fleet Android refuses the downgrade — rollback is a quarantine, not a restore. Quarantine never expires |
| Crash | `crash/CrashUploader.kt` | Uncaught exception → `POST /screens/status/:fp/crash-report` `source=manager` | **Bug:** used the Manager's own `ANDROID_ID`; on Android 8+ that is per package, so Manager crashes landed on a ghost row. Fixed here: the Player's fingerprint from the heartbeat provider first |
| Admin | `AdminReceiver.kt`, `res/xml/device_admin.xml` | `DeviceAdminReceiver` for `dpm set-device-owner`; `isDeviceOwner()` | Never provisioned (owner rule) |
| Permissions | `AndroidManifest.xml` | INTERNET, ACCESS_NETWORK_STATE, WAKE_LOCK, RECEIVE_BOOT_COMPLETED, FOREGROUND_SERVICE (+DATA_SYNC), POST_NOTIFICATIONS, REQUEST_INSTALL_PACKAGES, UPDATE_PACKAGES_WITHOUT_USER_ACTION, USE_FULL_SCREEN_INTENT; defines `HEALTH_PERMISSION` (signature); `<queries>` for both Player ids | No launcher activity by design |

**How it is installed and bootstrapped.** The Player's `MainActivity.onCreate` reads the installed Manager version (`readManagerVersion()` via PackageManager). Missing → the install gate ("Setting up companion service…") and `ManagerBootstrap.bootstrapIfNeeded` extract `assets/bundled/edu-cms-manager.apk` and commit a pinned, silent-where-earned `PackageInstaller` session; stale (installed < bundled) → `HOLD_AND_UPGRADE` with the same session; current → play. A NovaStar poster never bootstraps a companion (`SetupCeremonyMath.companionBootstrapRefusal`), and `/sdcard/edu-cms/skip-manager.txt` opts a panel out. The network fallback hard-codes a Railway host string (`ManagerBootstrap.downloadManagerApk`) and is reached only when the bundled asset is missing, which a CI build makes impossible (`verifyBundledManagerApk` fails the build).

**How the version reaches the dashboard.** The Player passes `&mv=<installed Manager versionName>` on the player URL (`MainActivity.loadPlayer`); the web player reports it as `versions.manager` (`apps/web/src/app/player/telemetry.ts`) and the heartbeat carries `?mv=`; the API writes `Screen.managerVersion` / `managerVersionAt` and clears both on an explicit empty value (`telemetry.controller.ts`, `screens.controller.ts`). The Manager itself also wrote the column from `/manager-update-check`.

### 2. Production telemetry (read-only SQL, 2026-11-08)

`screens`: 280 rows; 85 have ever reported a Player version; **39 APK screens were seen in the last 7 days**.

| `manager_version` | rows | seen 24 h | seen 7 d | has `player_version` |
|---|---|---|---|---|
| 1.0.24 | 39 | 29 | 35 | 39 |
| null | 237 | 2 | 4 | 42 |
| 1.0.24-debug / 1.0.21-debug / 1.0.17-debug | 4 | 0 | 0 | 4 |

The 237 nulls are **not a reporting bug**: 184 never reported a Player version at all (browser previews, never-paired or demo rows; none seen in 7 days, last ping 2026-10-28), 38 are the 1.0.8 debug-era Players last seen 2026-09-14, 8 are `hardware_model = web`, 2 are Taurus rows with no Player version. Only **4 live APK screens** have no Manager: one on 1.1.23, one on 1.1.64-field.1, one on 1.1.55-field.1 (all `generic-android`) and one NovaStar Taurus on 1.1.46-field.1 — the Taurus is the poster class that never bootstraps a companion by design; the other three sent the explicit "no Manager installed" signal, so the column is honest there (an operator uninstall or `skip-manager.txt`). **Every one of the 35 live screens with a Manager runs 1.0.24**, under Players from 1.1.12 to 1.1.64-field.1: the bundled path has had nothing to install for two months. Searches that prove the absences: the two `GROUP BY` queries over `manager_version`, `player_version`, `hardware_model`, `last_ping_at` in this session.

### 3. Every bug, gap and staleness found

1. **Two unreleased fixes.** a5c820ba7 (an update with no digest is refused — in `ManagerSelfUpdateWorker.kt`, `OtaWorker.kt`) and 565dd5b68 (the Manager's Player lane returns before any network call once a Player is installed; the API half is live). 1.0.24 in the field still runs the 30-minute Player lane, which the API refuses — a request and two `ota-state` reports per panel per half hour, filtered server-side as noise (`manager-lane-noise.ts`).
2. **The self-update lane is a fleet-wide push** with no gate (above). It never fired since 2026-09-01 only because the version never moved.
3. **Hand-typed version**; the bundled upgrade path is dormant; `check-hardware-qual.cjs`, `release-apk.sh`, `deploy-reliability.yml` and the APK workflow each grep the gradle literal separately.
4. **Device-owner story is stale in the artefacts.** The workflow's `manager-v*` release body still instructed `adb shell dpm set-device-owner` (removed here); `ManagerApp` keeps `pinPlayerAsHome` / `allowPlayerLockTask`; the matrix seeded `manager 1.0.24` fully `UNQUALIFIED` and the tag shipped anyway (the gate came one day later).
5. **Rollback is a quarantine, not a restore** on release-signed, non-device-owner panels (Android refuses the downgrade); `QuarantineList` never expires, so a Player versionCode that once failed first boot is refused by the bootstrap lane forever (only affects a kiosk with no Player).
6. **Crash fingerprint ghost row** (`CrashUploader.kt`) — fixed here.
7. **No Manager health telemetry.** The dashboard knows the version (via the Player) and nothing else: not whether the watchdog is alive, how often it relaunched the Player, whether a rollback fired, whether the install-permission notification is pending. The Manager reports `ota-state` anonymously (no device token, unlike the Player since 1.1.41); the API discards its "Manager v…" reports.
8. **What the Player learned that the Manager does not know:** credential renewal (the Manager holds no credential and signs nothing); NEEDS_TAP (the Manager's installs end at a notification nobody sees — the reason its Player lane was retired; the Player's `OtaAttemptPolicy` owns the rule); hardware classes (the Manager has no class notion; the fleet-push rules live server-side and apply to the Player's check); Android 9 FUH43 / WebView 66 (nothing engine-specific in the Manager; its watchdog relaunch via the launch intent is the same on every class); t982 deep-standby reboots (every reboot fires the Manager's boot lanes — now one, the bootstrap, which exits at once); the EP6N (sleep through `sdkapi` — the Manager's watchdog reads only the heartbeat, which the Player's process keeps writing while blanked, so a sleeping panel is not "dead"; unverified on the EP6N itself); the double-sided DH43 (one process, two faces — the watchdog relaunches `MainActivity`, which re-hosts faces; unverified on hardware).
9. **Can the Manager wedge?** The watchdog ticks on the main looper and every tick is bounded (a provider read, a `startActivity`); `START_STICKY` restarts it after a kill; `startForegroundService` from `BootReceiver` and `PackageReplacedReceiver` is allowed by the Android 12+ exemptions for those broadcasts. The known wedge is **a watchdog that cannot help**: a Player whose process is alive but whose WebView is blank keeps heartbeating, so the Manager never acts (that is the Player's own renderer-recovery job, `RendererRecoveryPolicy`). A dead Player is relaunched on every class that lets a foreground service start an activity (API 34 through the BAL-allowed PendingIntent, `Api34BalLauncher`); on an OEM ROM that drops that too, the HOME alias is the fallback and only when the operator set the Player as HOME.
10. **Strings.** Notification copy is English-only and says "EduCMS" (`ManagerApp.maybePromptForInstallPermission`, `OtaInstallReceiver.surfaceInstallPromptViaNotification`); the en/es/zh rule applies. Inventory, not fixed here.
11. **Dashboard grading** (`ScreenSettingsMenu.tsx`, `playerRollout.ts`) reads `managerVersionName` from `/latest-version`, which resolved `manager-v*` tags only; with the unit design it now reads the Manager asset inside the newest `player-v*` release (changed here).

### 4. The architecture question: merge, or one unit of two packages?

**Facts that decide it.**

- An Android APK installs exactly one package; a process cannot relaunch itself after the OS kills it, and a `PackageInstaller` session that replaces the calling package kills that process. An **external watchdog needs a second package** (its own UID and process). Merging the Manager into the Player loses: relaunch after a crash loop that the HOME alias does not cover (the Player is HOME only where an operator chose it), the post-install relaunch on ROMs that drop `PACKAGE_REPLACED` to the Player itself, and the bootstrap of a Player onto an empty kiosk.
- The **Player already updates itself** silently on Android 12+ as its own installer of record (`UPDATE_PACKAGES_WITHOUT_USER_ACTION` + `setRequireUserAction(USER_ACTION_NOT_REQUIRED)`; `OtaUpdateWorker.kt`, `Api31SilentInstall`) and with one Install tap on Android ≤ 11 (`OtaAttemptPolicy`, NEEDS_TAP). The Manager adds nothing to Player updates and never could without device owner, which the owner has ruled out.
- The **Player already carries and installs the Manager** (`bundleManagerApk`, `ManagerBootstrap`), with the exact rule the owner asked for: install only when the bundled versionCode is newer; never the same, never older (`ManagerUpgradeMath`). Where the Player bootstrapped the Manager it is the Manager's installer of record, so on Android 12+ that upgrade is silent; on 11 and 9 it is one Install tap, on the same screen visit as the Player's own tap, held behind the "Updating companion…" gate.
- Android 13/14 specifics: update ownership (`setRequestUpdateOwnership`, API 34, `Api34UpdateOwnership`) is requested on both installs so a vendor store cannot regress either package; on 14 the Manager's own activity launches go through `MODE_BACKGROUND_ACTIVITY_START_ALLOWED`. Android 9 and 11 get the prompt path; nothing here changes that.
- **What the best players do** (vendor docs only; read by a research agent this session, URLs below): none publishes a separate watchdog package — the platform (BrightSignOS, Tizen, webOS) or the OS kiosk mode is the watchdog. What they do publish is **staged delivery**: ScreenCloud rolls player updates 1 % → 5 % → 20 % → 50 % → 100 % with Stable and Canary channels and lets support exclude device ids ([how ScreenCloud releases updates](https://help.screencloud.com/en/articles/13435262-how-screencloud-releases-updates-for-players-pixi-and-screencloud-os)); OptiSigns Pro ships OTA weekly at a set day/time with "Latest Stable" vs "Beta Test" channels and a `forceOTA` command ([Pro player advanced features](https://support.optisigns.com/hc/en-us/articles/35577511423635-OptiSigns-Pro-Player-Advanced-Features)); BrightSign rarely auto-updates and tells customers to update one lab player, then a small group, with a scheduled OS update ([how to evaluate OS releases](https://docs.brightsign.biz/releases/how-to-evaluate-os-and-software-releases.md)); Yodeck's Android v2 auto-updates only in its "Production Setup" and legacy Android needs device owner for remote reboot ([Android APK v2 troubleshooting](https://www.yodeck.com/docs/user-manual/android-apk-v2-troubleshooting/)); Rise Vision's Android player does not auto-update a manual or MDM install at all ([Rise Player on Android](https://help.risevision.com/hc/en-us/articles/4402330525716-Install-Rise-Player-on-Android)); Samsung and LG publish firmware delivery through their own servers and reboot scheduling, nothing about agent packages. Our ladder (field window → tracked push → canary → fleet, one class, off-hours) is already at or past that bar for the Player; the Manager was the one artefact outside it.

**Verdict.** Keep **two packages**, make them **one release unit**: one version file, one CI run, one `player-v<unit>` tag and GitHub release carrying both APKs, one hardware-qualification section, one ladder — the Player's — and on the device the Player installs the companion only when its versionCode is newer. That is the owner's design, with the only part a single APK cannot provide (an external watchdog) kept.

### 5. The "even better" inventory (ranked by customer value, then risk; nothing here is implemented)

| # | Idea | Value | Risk | Notes |
|---|---|---|---|---|
| 1 | **Manager health in the heartbeat**: watchdog alive, relaunches performed, last relaunch reason, rollback/quarantine state, pending install-permission — carried by the Player's own signed heartbeat (read from the health provider), not by the Manager anonymously | High: the dashboard can say "companion healthy" instead of "companion version" | Low (telemetry only; `SCREEN_TELEMETRY_ONLY_FIELDS` discipline) | The Player would read a second provider row the Manager writes |
| 2 | **Signed Manager reports**: the Manager stops posting anonymous `ota-state` / `crash-report` and hands facts to the Player, which signs with the device token | High (anonymous OTA writes are the OTA-01 class) | Low | Removes the server-side noise filters over time |
| 3 | **A watchdog for the native alert watch** (life safety): the Manager verifies the Player's `NativeAlertWatch` is scheduled and alive while a panel is dark, and wakes the Player if not | Very high | Medium — emergency-adjacent; CHANGE class, different-vendor review, on-glass drill | Inventory only, per the brief |
| 4 | **Remote logs on demand**: a dashboard command that has the Player (or Manager) upload the last N minutes of logcat for both packages to a signed URL | High for support | Low–medium (PII in logs; redaction) | The Player already has `DiagnosticsUploadPolicy` |
| 5 | **Self-test**: a command that checks storage free, cert store, DNS, API reachability, WebView version, heartbeat latency and reports a verdict card | High | Low | Mostly Player work |
| 6 | **Storage health**: free space, write test, emergency-tier cache integrity, with pre-degradation alerts | High (the storage-aware chunk downloads of #260 need a signal) | Low | |
| 7 | **Scheduled reboot policy** per class, off-hours, never during playback or an alert, with proof of return | Medium–high (t982 deep-standby, EP6N) | Medium — a reboot is a mass action; needs the fleet-push rules | Owner's "never fight the Goodview CMS" applies |
| 8 | **Quarantine expiry / clear** from the dashboard; rollback honesty (say "cannot downgrade without device owner") | Medium | Low | |
| 9 | **Manager strings in en/es/zh**, VenueOS brand in notification copy | Medium | Low | Rule in `check-i18n-parity.cjs` does not cover Kotlin yet |
| 10 | **Remove device-owner dead code** (`pinPlayerAsHome`, `allowPlayerLockTask`, `AdminReceiver` policies) once the owner confirms no future DO path | Low | Low | Keeps the module honest |
| 11 | **Network diagnostics**: captive-portal probe result, DNS resolution of the API host, TLS chain check, Wi-Fi RSSI | Medium | Low | Overlaps the Network screen |
| 12 | **Install-tap prompting on the glass**, remote-operable, for Android ≤ 11 when a companion upgrade waits (today: a notification nobody sees) | Medium | Low | The Player's `InstallPromptGate` already does this for its own update |

## Recommendation (the design, in five lines)

1. **One version file**, `apps/player/versions.properties`: `unit.version` (the Player APK, the `player-v` tag, the matrix section) and `manager.version` (moves only when `apps/player/manager` changed; otherwise unchanged, so no screen reinstalls an unchanged companion). Both gradle files read it; a literal is refused by `scripts/check-apk-versions.cjs`.
2. **One CI run and one release**: the `player-v<unit>` tag builds both APKs, attaches both to one GitHub Release, mirrors both to storage; `manager-v*` tags are retired and the hardware gate refuses them. The `## Release: player <unit>` section qualifies the unit.
3. **One ladder**: the Manager reaches a screen only inside the Player APK, so it inherits the field window, the tracked push, the canary and the fleet-push rules the Player's `/update-check` already applies, per screen and per class. The field-candidate registry records the Manager's version, code, digest and size beside the Player's.
4. **Only the newer piece installs**: the Player installs the bundled Manager only when `bundled versionCode > installed` (`ManagerUpgradeMath`, now also pinned in `ManagerUpdatePolicy` on the Manager side); the server offers the Player only when newer (`semverGte`); neither ever downgrades.
5. **The side door is shut**: the Manager never updates itself (`ManagerUpdatePolicy.selfUpdateRetired`; the periodic job 1.0.24 persisted is cancelled on boot), and `/manager-update-check` answers `{ uptoDate: true, installVia: 'player' }` — the answer 1.0.24 reads as "nothing newer" — unless `MANAGER_SELF_UPDATE_LEGACY_LANE=on` re-opens the old lane for an owner-approved incident.

The first unified Manager is **1.1.29** (versionCode 10129 > 10024) and carries both pending fixes; its first build will be the next field candidate (`x.y.z-field.N` renames the Manager too, because `manager.version == unit.version` in this line).

## Risk

- **Android ≤ 11 screens take two Install taps** on the first unified release (Player, then the companion behind the "Updating companion…" gate). Later releases that do not touch the Manager cost one. Same as any companion upgrade since 1.1.12 (TC22 F2).
- **A Manager that changes but whose version is not raised** would ship new bytes under an old versionCode and never install. `check-apk-versions.cjs --base` refuses that in a PR (wired into the APK workflow and `deploy-reliability.yml`; `release-apk.sh` detects it from the previous tag).
- **`/manager-apk/latest` and `/manager-apk/v/:vc`** now resolve from the Manager asset inside `player-v*` releases as well as legacy `manager-v*` tags. The naming helper `isManagerAssetName` accepts any prefix (`edu-cms-` today, `venueos-` after the rename in flight).
- **The player resolver must never pick the Manager asset** that now rides the same release: `resolveLatestReleaseInfo` filters Manager-named assets out before `pickApkAsset`; `ensureApkInCache` filters per kind. Pinned by `player-ota.spec.ts`.
- **Unproven on hardware**: nothing here was run on a panel. The bundled-upgrade path itself shipped in 1.1.12 and ran on the TC22; the one new on-device behaviour is `cancelUniqueWork` of the legacy job, which is a WorkManager API call.

## Validation

Run in this session (worktree `fable/manager-unified-release`):

- `node scripts/check-apk-versions.cjs --self-test` — 8/8; `node scripts/check-apk-versions.cjs` and `--base origin/master` — ok (unit 1.1.29 / manager 1.1.29).
- `node scripts/check-hardware-qual.cjs player` reads the version from the properties file (exit 1 — the OVERRIDE cells, unchanged); `--tag manager-v1.0.25` is refused with the retirement message.
- `cd apps/api && npx jest src/player-ota src/field-builds` — 22 suites, 376 tests passed (includes `manager-update-lane.spec.ts`, the registry `manager` record cases, the asset-name cases).
- `cd apps/api && pnpm run build` — exit 0 (`dist/player-ota/manager-update-lane.js` present). `npx tsc --noEmit -p tsconfig.json` reports only pre-existing spec errors in `src/templates/*`, `src/tenants/*`, `src/users/*` (files untouched here).
- `cd apps/web && npx tsc --noEmit` — 0 errors.
- `bash scripts/ota-wiring-check.sh` — 11 passed.
- `node scripts/check-rulebook.cjs` — PASS.
- Kotlin: `cd apps/player && JAVA_HOME=/opt/homebrew/opt/openjdk@17 ./gradlew :app:testDebugUnitTest :manager:testDebugUnitTest` — see the report for the result (the wrapper jar and `local.properties` are not committed; the worktree needed both copied in).

Owed on the glass before the first unified release: the companion upgrade 1.0.24 → 1.1.29 on one Android 11 (GUQ) and one Android 13 (M43 / L55VEC) bench screen via a field window; proof that the retired job stops polling (`[mgr-ota]` lines stop for that fingerprint); proof that an untouched-Manager release later does not reinstall it.

## Rollback

Revert the PR. The API change is additive and defaults to the retired lane; `MANAGER_SELF_UPDATE_LEGACY_LANE=on` restores today's `manager-update-check` behaviour without a deploy. The device side changes only in the next APK build; 1.0.24 keeps polling and keeps receiving "up to date".

## Decision

Owner's go needed for: (a) the one-release-unit design above; (b) building the first unified candidate (`1.1.66-field.1`, Manager `1.1.66-field.1`) and arming a bench window; (c) retiring `manager-v*` tags for good. Nothing is tagged or published by this change.
