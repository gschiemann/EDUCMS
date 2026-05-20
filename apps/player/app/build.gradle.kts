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
        versionCode = 10072
        versionName = "1.0.72"

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
    signingConfigs {
        getByName("debug") {
            storeFile = file("debug.keystore")
            storePassword = "android"
            keyAlias = "androiddebugkey"
            keyPassword = "android"
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
// The Copy task depends on :manager:assembleDebug so building Player
// implicitly builds Manager first. The output universal Manager APK
// goes into src/main/assets/bundled/edu-cms-manager.apk where AGP
// picks it up via the standard mergeAssets task.
val bundleManagerApk by tasks.registering(Copy::class) {
    dependsOn(":manager:assembleDebug")
    val managerOutDir = project(":manager").layout.buildDirectory.dir("outputs/apk/debug")
    from(managerOutDir) {
        // Universal APK works on any ABI. Per-ABI splits aren't
        // useful for a bundled installer payload — we want the
        // single artifact that PackageInstaller can hand to the
        // system regardless of the host kiosk's CPU.
        include("*-universal*.apk", "*universal*.apk")
    }
    into(layout.projectDirectory.dir("src/main/assets/bundled"))
    rename { "edu-cms-manager.apk" }
}

// Wire the bundle task to run before any merge*Assets task so the
// asset is included in the final APK. matching{} + configureEach{}
// covers all variants (debug/release, per-ABI splits, universal).
tasks.matching { it.name.matches(Regex("merge.*Assets")) }.configureEach {
    dependsOn(bundleManagerApk)
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
