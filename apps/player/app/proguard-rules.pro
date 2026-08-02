# Player release (R8) rules.
#
# Added 2026-08-01 with the release-signing work. `app/build.gradle.kts`
# has ALWAYS declared `proguardFiles(..., "proguard-rules.pro")` on the
# release buildType, but the file did not exist — because the release
# buildType has never actually been built (CI ships assembleDebug; see
# apps/player/RELEASE_SIGNING.md). This file exists so that
# `assembleRelease` is runnable at all, and so the reflective surfaces
# below survive minification.
#
# ⚠️ These rules are WRITTEN BUT UNVERIFIED — no Android SDK was
# available when they were authored, so no release build has ever been
# run against them. Building + smoke-testing a minified release APK on
# real hardware is an explicit, non-skippable step of the cutover
# checklist in apps/player/RELEASE_SIGNING.md. Do not assume "it
# compiles" means "the kiosk still works."

# ── WebView JavaScript bridge ────────────────────────────────────────
# WebAppBridge is reached ONLY from JavaScript, by name, at runtime.
# R8 cannot see those call sites, so without this keep it strips or
# renames every @JavascriptInterface method and the entire web layer
# goes silently dead (no crash — the JS call just resolves to
# undefined). Same for the CTS serial bridge.
-keep class com.educms.player.WebAppBridge { *; }
-keep class com.educms.player.serial.** { *; }
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ── Manifest-declared components ─────────────────────────────────────
# AGP keeps these automatically from the merged manifest, but being
# explicit costs nothing and documents the contract.
-keep class com.educms.player.PlayerApp { *; }
-keep class com.educms.player.heartbeat.** { *; }

# ── WorkManager ──────────────────────────────────────────────────────
# Workers are instantiated reflectively by class name.
-keep class * extends androidx.work.ListenableWorker {
    public <init>(android.content.Context, androidx.work.WorkerParameters);
}

# ── Keep source line numbers in crash reports ────────────────────────
-keepattributes SourceFile,LineNumberTable
-renamesourcefileattribute SourceFile
