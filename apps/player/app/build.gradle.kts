import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.educms.player"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.educms.player"
        // Android 7.0 (Nougat) → Android 14
        minSdk = 24
        targetSdk = 34
        // versionCode MUST match the API's semver-encoding formula:
        //   major*10000 + minor*100 + patch  (e.g. 1.0.33 → 10033)
        // WatchdogService compares PackageManager.versionCode against
        // InstallState.pendingVc which the API returns as the derived value.
        // Keeping them in sync prevents a false rollback after a successful install.
        // 2026-05-15 — sandbox-verified OTA chain + auto-relaunch fix.
        //
        // v1.0.58 → v1.0.59 install was verified in the Android 14
        // emulator sandbox (OtaUpdateWorker → PackageInstaller.Session
        // committed, on-device versionCode bumped, zero operator taps).
        // BUT MainActivity did NOT auto-relaunch. v1.0.61 (a
        // MY_PACKAGE_REPLACED receiver) and v1.0.62 (FGS trampoline)
        // both tried to launch MainActivity from Player's own process
        // and both were BAL-blocked. The PACKAGE_REPLACED grant logged
        // on the v1.0.62 install told the whole story:
        //
        //   BackgroundStartPrivileges[allowsBackgroundActivityStarts
        //     =false, allowsBackgroundForegroundServiceStarts=true]
        //
        // The grant permits FGS starts and explicitly FORBIDS activity
        // starts — Android 14 deliberately stops an app foregrounding
        // itself right after its own install. No receiver / FGS /
        // same-UID trick gets past it.
        //
        // THE FIX (verified in sandbox 2026-05-15): Manager set as
        // DEVICE OWNER. Device-owner apps are BAL-exempt, so Manager's
        // WatchdogService relaunches Player after install — confirmed:
        // `dpm set-device-owner com.educms.manager/...AdminReceiver`
        // then `WatchdogService: launched com.educms.player (recovery)`
        // with NO BAL_BLOCK, MainActivity foregrounded. Device owner
        // ALSO makes the install fully silent (Api31SilentInstall's
        // USER_ACTION_NOT_REQUIRED is honored). v1.0.61/v1.0.62
        // Player-side receivers stay as harmless defense-in-depth.
        //
        // v1.0.64 — THE real auto-relaunch fix: KioskHomeAlias.
        // Player ships a HOME activity-alias (disabled by default);
        // once Player is the home launcher the OS itself returns to
        // it after every death — including its own OTA self-update —
        // with a system-initiated launch that Android 14 BAL never
        // blocks. v1.0.64 enabled that alias ONLY under Device Owner.
        //
        // v1.0.65 — non-Device-Owner Home-app path. Operators who
        // can't provision Device Owner (no factory reset) get a
        // first-run prompt (MainActivity.maybePromptForHomeAppSetup)
        // that enables the alias + deep-links to the Home-app picker.
        // Once they pick Venue OS Player as Home, the OS auto-relaunch
        // works identically to the Device-Owner path — the operator
        // just taps "Install" on each update instead of zero taps.
        // The `kioskHomeOptIn` pref keeps the alias enabled across
        // restarts. Alias still ships disabled so OEM-CMS boxes are
        // untouched unless the operator opts in.
        // 2026-08-03 — v1.1.0, the security wave. A MINOR bump, not a patch,
        // because this build is not a drop-in successor to 1.0.74:
        //   * Release-signed with the real VenueOS key instead of the public
        //     committed debug keystore, so the shipped applicationId is now
        //     `com.educms.player` (release) rather than `com.educms.player.debug`.
        //     Android treats those as DIFFERENT APPS — this installs alongside
        //     an old build, it does not update it.
        //   * android:debuggable is gone (was readable via `adb run-as`).
        //   * JS bridge now also exposed via WebViewCompat.addWebMessageListener
        //     with origin + main-frame checks; legacy addJavascriptInterface is
        //     kept in parallel this release (see NativeBridgeChannel header for
        //     the legacy-removal criteria).
        //   * Kiosk lock task mode (LockTaskController), device-owner gated.
        //   * OTA host pinning, serial-bridge shell injection fix, intent
        //     redirection fix, USB receiver action check.
        versionCode = 10101
        versionName = "1.1.1"

        // Override at build time:  -PplayerBaseUrl="https://your.app/player"
        val playerBaseUrl: String = (project.findProperty("playerBaseUrl") as? String)
            ?: System.getenv("PLAYER_BASE_URL")
            ?: "https://venue-os.app/player"
        buildConfigField("String", "PLAYER_BASE_URL", "\"$playerBaseUrl\"")
    }

    buildFeatures {
        buildConfig = true
        viewBinding = true
    }

    // ABI targeting for the hardware we deploy on:
    //   - arm64-v8a     Most modern Android media players, Nova Taurus
    //                   TB40/50/60 (Rockchip RK3399/RK3588, 64-bit ARM)
    //   - armeabi-v7a   Older / lower-end Taurus (TB30, some TB40) on
    //                   32-bit Rockchip RK3288
    //   - x86_64        Emulator + desktop dev only (debug APKs only)
    // Splits produce per-ABI APKs so the operator downloads ~40% smaller
    // files; also a universal APK as a safety net for unknown boards.
    splits {
        abi {
            isEnable = true
            reset()
            include("armeabi-v7a", "arm64-v8a", "x86_64")
            isUniversalApk = true
        }
    }

    // ─── RELEASE signing — real, but DORMANT until the owner cuts over ───
    //
    // ⚠️ READ apps/player/RELEASE_SIGNING.md BEFORE TURNING THIS ON. ⚠️
    //
    // Today CI still publishes the DEBUG build (see
    // .github/workflows/android-player-apk.yml). This block exists so the
    // secure path is ONE deliberate step away — it does NOT change what
    // signs today's builds. Flipping to a real release key ROTATES the
    // signing identity, and Android refuses an update signed with a
    // different key (INSTALL_FAILED_UPDATE_INCOMPATIBLE) — every screen
    // already in the field must then be MANUALLY REINSTALLED. That is a
    // fleet-wide operational event; schedule it deliberately.
    //
    // Config is read from Gradle properties with an env fallback — the
    // exact same pattern as `playerBaseUrl` in defaultConfig above:
    //
    //   -PreleaseStoreFile=…      / RELEASE_STORE_FILE
    //   -PreleaseStorePassword=…  / RELEASE_STORE_PASSWORD
    //   -PreleaseKeyAlias=…       / RELEASE_KEY_ALIAS
    //   -PreleaseKeyPassword=…    / RELEASE_KEY_PASSWORD
    //
    // A relative RELEASE_STORE_FILE resolves against the Gradle ROOT
    // project (apps/player/) so :app and :manager resolve the SAME file
    // from one value. Absolute paths are used as-is.
    //
    // GRACEFUL DEGRADATION IS THE POINT: if any value is missing, or the
    // keystore file isn't on disk, the "release" signingConfig is simply
    // NEVER CREATED. `assembleDebug` keeps working byte-for-byte as it
    // does today, and `assembleRelease` produces an unsigned APK instead
    // of failing the build. Nothing breaks for anyone building locally
    // or in CI right now.
    //
    // (Historical note: commit 54bb67d tried `signingConfigs.create(...)`
    // with no storeFile at config time and AGP rejected it. We only call
    // create() once every value is present AND the file exists, so the
    // config is always fully populated.)
    val releaseStoreFile: String? = (project.findProperty("releaseStoreFile") as? String)
        ?: System.getenv("RELEASE_STORE_FILE")
    val releaseStorePassword: String? = (project.findProperty("releaseStorePassword") as? String)
        ?: System.getenv("RELEASE_STORE_PASSWORD")
    val releaseKeyAlias: String? = (project.findProperty("releaseKeyAlias") as? String)
        ?: System.getenv("RELEASE_KEY_ALIAS")
    val releaseKeyPassword: String? = (project.findProperty("releaseKeyPassword") as? String)
        ?: System.getenv("RELEASE_KEY_PASSWORD")

    val releaseStore: File? = releaseStoreFile
        ?.takeIf { it.isNotBlank() }
        ?.let { p ->
            val f = File(p)
            if (f.isAbsolute) f else project.rootProject.file(p)
        }

    val hasReleaseSigning: Boolean =
        releaseStore != null && releaseStore.isFile &&
            !releaseStorePassword.isNullOrBlank() &&
            !releaseKeyAlias.isNullOrBlank() &&
            !releaseKeyPassword.isNullOrBlank()

    signingConfigs {
        // Stable debug keystore — committed at apps/player/app/debug.keystore.
        //
        // Why this exists: Android's PackageInstaller refuses to install an
        // upgrade APK that's signed with a different key than the installed
        // version (`INSTALL_FAILED_UPDATE_INCOMPATIBLE`). CI's default
        // `assembleDebug` flow generates a fresh per-runner debug keystore
        // every build, so each release was signed with a different key and
        // OTA install was IMPOSSIBLE — operators had to uninstall + USB
        // reinstall on every version, which also wiped pairing tokens
        // because Settings.Secure.ANDROID_ID is scoped per (signing-key +
        // package + user) on Android 8+.
        //
        // This block points the debug signingConfig at the committed
        // keystore so every CI build signs with the same key. New APK
        // installs cleanly over the old one; pairing survives.
        //
        // Earlier attempts: commit 54bb67d tried to do this with
        // signingConfigs.create("debugStable") which created a config
        // with no storeFile at config time and AGP rejected. Reverted in
        // 6eb4812. This iteration uses getByName("debug") which already
        // exists, just overrides its storeFile — no new config to break.
        //
        // ⚠️ THIS KEY IS PUBLISHED. The repo is public and the password is
        // three lines below it, so it must be treated as compromised. It
        // is retired by the cutover in apps/player/RELEASE_SIGNING.md.
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
        }

        // Created ONLY when fully configured — see the block comment above.
        if (hasReleaseSigning) {
            create("release") {
                storeFile = releaseStore
                storePassword = releaseStorePassword
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
            }
        }
    }

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
            // Explicit — already implicit via signingConfigs.debug, but
            // makes intent clear at the buildType level.
            signingConfig = signingConfigs.getByName("debug")
        }
        getByName("release") {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
            // NEVER let a published artifact inherit a debuggable default.
            // This is already AGP's default for `release`, but stating it
            // explicitly means a future edit can't quietly flip it, and the
            // CI guard (scripts/check-apk-debuggable.cjs) has something
            // unambiguous to verify in the merged manifest.
            isDebuggable = false
            if (hasReleaseSigning) {
                signingConfig = signingConfigs.getByName("release")
            }
        }
    }

    compileOptions {
        isCoreLibraryDesugaringEnabled = true
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    packaging {
        resources {
            excludes += setOf("META-INF/AL2.0", "META-INF/LGPL2.1")
        }
    }
}

// ─── Bundle Manager APK in Player's assets ────────────────────────
// v1.0.14 — operator-reported repeated failures of the network-based
// Manager bootstrap (Vercel routing, timing races, silent failures).
// Solution: ship Manager APK INSIDE Player so first-run install is
// purely local. ~2MB Manager + ~7.5MB Player = ~9.5MB total APK,
// within sideload-friendly size; no network, no Vercel, no GitHub
// rate limits at install time.
//
// The Copy task depends on the matching :manager:assemble* variant so
// building Player implicitly builds Manager first. The output universal
// Manager APK goes into src/main/assets/bundled/edu-cms-manager.apk
// where AGP picks it up via the standard mergeAssets task.
//
// ✅ CUTOVER TRAP FIXED (2026-08-03). This was hardcoded to
// :manager:assembleDebug, so the first release-signed Player (v1.1.0)
// shipped with a DEBUG-signed Manager in its assets — mixed signing
// identities in one artifact, and a bundled Manager the release-signed
// era can never update (RELEASE_SIGNING.md Step 5). It now keys off the
// SAME signal the signingConfig uses: when the four release-signing
// values are present (CI release builds), bundle the RELEASE Manager;
// otherwise the debug flow is byte-for-byte unchanged. The doLast guard
// makes "signing didn't engage" (an `-unsigned` output, or no universal
// output at all) a HARD build failure instead of a silently missing or
// uninstallable bundled Manager. First build carrying this fix should be
// the reinstall-tour build (v1.1.1) — do not tour with v1.1.0.
val bundledManagerUsesRelease: Boolean = run {
    // Recomputed here because the android{} block's equivalent vals are
    // lambda-scoped. Same property/env names, same file resolution.
    val storePath = (project.findProperty("releaseStoreFile") as? String)
        ?: System.getenv("RELEASE_STORE_FILE")
    val store = storePath?.takeIf { it.isNotBlank() }?.let { p ->
        val f = File(p)
        if (f.isAbsolute) f else project.rootProject.file(p)
    }
    val storePassword = (project.findProperty("releaseStorePassword") as? String)
        ?: System.getenv("RELEASE_STORE_PASSWORD")
    val keyAlias = (project.findProperty("releaseKeyAlias") as? String)
        ?: System.getenv("RELEASE_KEY_ALIAS")
    val keyPassword = (project.findProperty("releaseKeyPassword") as? String)
        ?: System.getenv("RELEASE_KEY_PASSWORD")
    store != null && store.isFile &&
        !storePassword.isNullOrBlank() &&
        !keyAlias.isNullOrBlank() &&
        !keyPassword.isNullOrBlank()
}

val bundleManagerApk by tasks.registering(Copy::class) {
    val managerVariantDir = if (bundledManagerUsesRelease) "release" else "debug"
    dependsOn(if (bundledManagerUsesRelease) ":manager:assembleRelease" else ":manager:assembleDebug")
    val managerOutDir = project(":manager").layout.buildDirectory.dir("outputs/apk/$managerVariantDir")
    from(managerOutDir) {
        // Universal APK works on any ABI. Per-ABI splits aren't
        // useful for a bundled installer payload — we want the
        // single artifact that PackageInstaller can hand to the
        // system regardless of the host kiosk's CPU.
        include("*-universal*.apk", "*universal*.apk")
        // An `-unsigned` release output means signing did not engage.
        // Never bundle it — the doLast below turns that into a loud
        // build failure rather than an uninstallable asset.
        exclude("*unsigned*")
    }
    into(layout.projectDirectory.dir("src/main/assets/bundled"))
    rename { "edu-cms-manager.apk" }
}

// The guard CANNOT live in a doLast on the Copy above: a Copy whose
// include/exclude filters match zero files is skipped as NO-SOURCE and
// its actions never run — which is precisely the failure being guarded
// (release signing didn't engage → only an `-unsigned` APK existed →
// exclude left nothing). A companion task always executes.
val verifyBundledManagerApk by tasks.registering {
    dependsOn(bundleManagerApk)
    doLast {
        val bundled = layout.projectDirectory
            .dir("src/main/assets/bundled").file("edu-cms-manager.apk").asFile
        if (!bundled.isFile) {
            throw GradleException(
                "bundleManagerApk produced no edu-cms-manager.apk (wanted the " +
                    (if (bundledManagerUsesRelease) "RELEASE" else "DEBUG") +
                    " variant) — either the Manager build made no universal APK, or " +
                    "the only candidate was '-unsigned' (release signing did not " +
                    "engage). Refusing to ship a Player without a matching-signature " +
                    "bundled Manager.",
            )
        }
    }
}

// Wire the bundle task to run before anything that READS the assets dir, so
// the bundled Manager APK is present and Gradle's task graph is explicit.
//
// merge*Assets is the obvious consumer. lint*Analyze* is the non-obvious one:
// `lintVitalAnalyzeRelease` runs ONLY on release builds, reads the same
// `src/main/assets/bundled` directory, and without this dependency Gradle
// fails the whole build with "uses this output of task ':app:bundleManagerApk'
// without declaring an explicit or implicit dependency".
//
// That is why this was invisible until the first real `assembleRelease`
// (2026-08-03, the signing cutover) — debug builds never run lintVital, so
// every previous CI run was green while the release path was broken.
// AGP spells these several ways across variants — lintVitalAnalyzeRelease,
// generateReleaseLintVitalReportModel, lintReportRelease … so match ANY task
// whose name mentions Lint rather than trying to enumerate them. Over-matching
// is harmless here: the dependency only guarantees ordering.
tasks.matching {
    it.name.matches(Regex("merge.*Assets")) || it.name.contains("Lint") || it.name.startsWith("lint")
}.configureEach {
    // Through the VERIFY task (which depends on the copy), so a missing /
    // unsigned bundled Manager fails the build instead of shipping silently.
    dependsOn(verifyBundledManagerApk)
}

// Keep the assets/bundled/ directory clean across builds.
tasks.named("clean") {
    doLast {
        delete(layout.projectDirectory.dir("src/main/assets/bundled"))
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.webkit:webkit:1.11.0")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    // Storage Access Framework helpers — used by USB sneakernet ingest
    implementation("androidx.documentfile:documentfile:1.0.1")

    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
