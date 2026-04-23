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
        versionCode = 8
        versionName = "1.0.8"

        // Override at build time:  -PplayerBaseUrl="https://your.app/player"
        val playerBaseUrl: String = (project.findProperty("playerBaseUrl") as? String)
            ?: System.getenv("PLAYER_BASE_URL")
            ?: "https://educms-five.vercel.app/player"
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

    buildTypes {
        getByName("debug") {
            isMinifyEnabled = false
            applicationIdSuffix = ".debug"
            versionNameSuffix = "-debug"
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
