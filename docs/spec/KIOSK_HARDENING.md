# Kiosk Mode & Device Hardening

## 1. App-Level Hardening
*   **Lock Task Mode:** Utilize Android's built-in `startLockTask()` to pin the application. This requires the application to be the Device Owner or given LockTask whitelist permissions via MDM.
*   **Touch Lock Strategy:** 
    *   By default, all touch events on the root view are intercepted and consumed, preventing interaction with WebView or ExoPlayer.
    *   For interactive deployments (wayfinding), touch is enabled but long presses, multi-finger gestures, and edge swipes are intercepted.
*   **Escape Gesture Disabling:** Intercept `onKeyDown` and `onBackPressed` to prevent generic Android UI navigation (Back, Home, Recent Apps). Volume keys are locked to software-defined maximums.

## 2. OS-Level Recommendations (AOSP / MDM)
*   **ADB Access:** Disable USB Debugging and ADB over Wi-Fi on production units.
*   **Ports:** Physically block unused USB ports or disable USB Mass Storage in OS builds.
*   **Settings Access:** Standard Android settings menus must be strictly disabled or password-protected via MDM.
*   **Navigation Bar:** Hide system UI via `View.SYSTEM_UI_FLAG_HIDE_NAVIGATION` and `View.SYSTEM_UI_FLAG_FULLSCREEN` (Immersive Sticky Mode).

## 3. Tampering Protections
*   **No Sideloading:** OS configured to disallow installations from unknown sources (`Settings.Secure.INSTALL_NON_MARKET_APPS = 0`).
*   **Root Detection:** The app runs basic safety checks on start (e.g., checking for SU binaries, SafetyNet/Play Integrity checks if standard Google Play Services are available).

## 4. Signed App Update Path
*   **Silent Updates:** The app downloads APK updates securely over HTTPS and verifies the signature matches the existing installation.
*   **Device Owner Install:** If functioning as Device Owner, `PackageInstaller` API is used to install updates silently without user prompts.
