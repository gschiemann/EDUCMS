# 2026-11-08 — customer-visible "edu" names → VenueOS

Owner: "fix the visible ones now". Branch `claude/venueos-visible-names`.

Rule: every READ path accepts both `edu-cms-*` and `venueos-*`; only new builds/writes use `venueos-*`.

- APK files/artifacts → `venueos-player-v*.apk` / `venueos-manager-v*.apk`, artifacts `venueos-*-apk`. Storage reads try new then legacy object (sidecar of the same candidate vouches); release-asset and CI-artifact lookups prefer new, fall back to old. Field candidates are served from `field-player/<sha256>.apk` (digest-keyed), so every registered entry incl. 1.1.65-field.1 is unaffected.
- Old on-device code never depends on served filenames (fixed local names, sha-verified). `bundled/edu-cms-manager.apk` inside the player APK and the `edu-cms-manager-install` prefs file are internal and unchanged.
- Player setup screen "EduCMS" → "VenueOS"; every operator-visible Kotlin string (notifications, toasts, setup hints, errors, the "VenueOS Updates" channel name — channel ids unchanged) and the provisioning-script text.
- USB: APK reads `venueos-content*` and `edu-cms-content*`. Server keeps writing `edu-cms-content` until `USB_EXPORT_FOLDER_NAME=venueos` is set (flip once the fleet runs a build > 1.1.65). Schema id `edu-cms-usb-bundle/v1` unchanged (HMAC-covered format id).
- Removed dead `cdn.educms.io` from CSP + images.remotePatterns.

Kept on purpose (renaming breaks devices/data): package `com.educms.*`, `data-educms-*` board attributes, browser storage keys, `X-EduCMS-Source`, `/sdcard/edu-cms/` flag paths, Kotlin packages, repo name.

Verified locally: API player-ota/usb-export/sentry Jest 22 suites/335 tests; API build; web tsc; rulebook; Kotlin `:app:testDebugUnitTest` 1,589 tests + `:app:lintDebug`; workflow YAML parses. Not verified: CI, a live release/bucket, on-glass text, a real USB stick.
