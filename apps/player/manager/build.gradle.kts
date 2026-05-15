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
        // 2026-05-15 — v1.0.20: post-install Player ACTIVITY relaunch.
        //
        // Sandbox testing of the full OTA chain found the last gap:
        // after a successful Player install, the new APK's services
        // come back (heartbeat goes fresh) but its signage Activity
        // never foregrounds — Player can't background-launch itself
        // (BAL-blocked, not the device owner) and the watchdog's
        // missed-heartbeat path never fires because the heartbeat
        // SERVICE is alive. WatchdogService now relaunches the Player
        // activity in its post-install `sawNewBoot` branch — Manager,
        // as device owner, is BAL-exempt and can do it. See
        // WatchdogService.kt for the full reasoning.
        //
        // v1.0.19 (last tagged release) verified Manager auto-update
        // works. v1.0.20 closes the auto-relaunch gap. Earlier
        // v1.0.16/17/18 source bumps shipped without release tags;
        // v1.0.19 + v1.0.20 both get proper `manager-v*` tags.
        versionCode = 10020 // 1*10000 + 0*100 + 20
        versionName = "1.0.20"

        // Override at build time to point at a non-default API:
        //   -PmanagerApiRoot="https://staging.educms-five.vercel.app"
        // Same env-var fallback chain as Player keeps CI flexibility.
        val managerApiRoot: String = (project.findProperty("managerApiRoot") as? String)
            ?: System.getenv("MANAGER_API_ROOT")
            ?: "https://educms-five.vercel.app"
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

    // Reuse the SAME committed debug keystore as the Player module so
    // OTA installs work in both directions (Player can update Manager,
    // Manager can update Player). Critical: signature mismatch between
    // the two apps would not break each other (different package ids)
    // but it WOULD make us inconsistent on which key signs what; same
    // key for both keeps the operational model trivial.
    signingConfigs {
        getByName("debug") {
            storeFile = file("../app/debug.keystore")
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
