/**
 * EduCMS Manager APK — companion to the Player APK.
 *
 * Architecture overview in scratch/manager-apk/01-architecture-decision.md.
 *
 * Roles (Phase 1):
 *   - Holds DEVICE_OWNER privileges so OTA installs are silent
 *     (no system "Install / Cancel" prompt on unattended kiosks)
 *   - Watchdog: separate process, pings Player every 30s via
 *     ContentProvider, restarts Player if 3 consecutive pings fail
 *   - OTA installer: downloads + verifies + installs Player updates
 *     via PackageInstaller.Session (silent thanks to DEVICE_OWNER)
 *   - Boot launcher: starts Player on boot
 *
 * Same SDK + signing setup as the Player APK so OTA installs of
 * either component upgrade cleanly without signature mismatches.
 */
import java.io.File

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.educms.manager"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.educms.manager"
        // Same minSdk as Player so we deploy on identical hardware
        minSdk = 24
        targetSdk = 34
        // versionCode MUST match the API's semver-encoding formula:
        //   major*10000 + minor*100 + patch  (e.g. 1.0.9 → 10009)
        // ManagerSelfUpdateWorker compares installed versionCode against
        // the API-returned derivedVersionCode; they must share the same scheme.
        //
        // 2026-05-15 — v1.0.21: pin Player as the HOME launcher.
        //
        // The OTA auto-relaunch saga: v1.0.61/62 tried Player-side
        // receiver + FGS tricks to relaunch MainActivity — all
        // BAL-blocked by Android 14. Manager v1.0.20 added a
        // watchdog activity-launch — works, but only catches the
        // case after a delay and only if Manager did the install.
        //
        // v1.0.21 is the real fix: Manager (device owner) calls
        // DevicePolicyManager.addPersistentPreferredActivity() to pin
        // Player's KioskHomeAlias as the persistent preferred HOME
        // activity. Once Player is HOME, the OS itself returns to it
        // after ANY death — OTA self-update, crash, reboot — with a
        // system-initiated launch that BAL never blocks. This is the
        // canonical Android Enterprise dedicated-device pattern.
        // v1.0.20's watchdog relaunch stays as a belt-and-suspenders
        // backstop. See ManagerApp.pinPlayerAsHome().
        // 2026-08-03 — v1.0.23. Patch bump: adds allowPlayerLockTask()
        // (setLockTaskPackages for the Player + Manager pair) so the Player's
        // LockTaskController can pin the kiosk. Also release-signed with the
        // real VenueOS key from this build onward.
        versionCode = 10024 // 1*10000 + 0*100 + 23
        versionName = "1.0.24"

        // Override at build time to point at a non-default API:
        //   -PmanagerApiRoot="https://staging.venue-os.app"
        // Same env-var fallback chain as Player keeps CI flexibility.
        val managerApiRoot: String = (project.findProperty("managerApiRoot") as? String)
            ?: System.getenv("MANAGER_API_ROOT")
            ?: "https://venue-os.app"
        buildConfigField("String", "API_ROOT", "\"$managerApiRoot\"")

        // The package name we manage. Pinned so Manager refuses to
        // install any APK whose package id doesn't match — defends
        // against an attacker swapping a different APK into the
        // download dir to escalate via our DEVICE_OWNER privileges.
        buildConfigField("String", "PLAYER_PACKAGE", "\"com.educms.player\"")
    }

    buildFeatures {
        buildConfig = true
    }

    // ABI matches Player so a single CI run produces matching binaries
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
    // Mirror of the block in ../app/build.gradle.kts — same four
    // properties, same env fallback, same graceful degradation. Manager
    // and Player MUST resolve the SAME release keystore (Manager is
    // DEVICE_OWNER and installs Player updates; a split signing identity
    // makes the operational model incoherent), which is why a relative
    // RELEASE_STORE_FILE resolves against the Gradle ROOT project
    // (apps/player/) in BOTH modules rather than the module dir.
    //
    //   -PreleaseStoreFile=…      / RELEASE_STORE_FILE
    //   -PreleaseStorePassword=…  / RELEASE_STORE_PASSWORD
    //   -PreleaseKeyAlias=…       / RELEASE_KEY_ALIAS
    //   -PreleaseKeyPassword=…    / RELEASE_KEY_PASSWORD
    //
    // If any value is missing or the keystore isn't on disk, the
    // "release" signingConfig is never created — `assembleDebug` is
    // completely unaffected and the build does not fail.
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
        // Reuse the SAME committed debug keystore as the Player module so
        // OTA installs work in both directions (Player can update Manager,
        // Manager can update Player). Critical: signature mismatch between
        // the two apps would not break each other (different package ids)
        // but it WOULD make us inconsistent on which key signs what; same
        // key for both keeps the operational model trivial.
        //
        // ⚠️ THIS KEY IS PUBLISHED — see ../app/build.gradle.kts and
        // apps/player/RELEASE_SIGNING.md. Treat it as compromised.
        getByName("debug") {
            storeFile = file("../app/debug.keystore")
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
            // Already AGP's default for `release`; explicit so a future
            // edit can't quietly flip it and so the CI guard
            // (scripts/check-apk-debuggable.cjs) has something
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

    // 2026-08-30 (W2-5) — see the matching block in app/build.gradle.kts
    // for the full rationale. Short version: `lintDebug` is now a blocking
    // pre-assemble CI gate, and Manager carries the same pre-existing
    // Api34UpdateOwnership MissingPermission finding the Player does
    // (ENFORCE_UPDATE_OWNERSHIP is privileged — a normal app cannot hold
    // it, and the call is already written to tolerate being ignored).
    // Baselined rather than disabled so a NEW lint error still fails.
    lint {
        baseline = file("lint-baseline.xml")
    }
}

dependencies {
    coreLibraryDesugaring("com.android.tools:desugar_jdk_libs:2.0.4")

    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.4")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("androidx.datastore:datastore-preferences:1.1.1")

    testImplementation("junit:junit:4.13.2")
}
