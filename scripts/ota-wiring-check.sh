#!/usr/bin/env bash
# OTA wiring integrity check.
#
# Catches the bug classes that have repeatedly broken silent OTA on the
# operator's kiosks — without requiring an emulator, an APK build, or
# the operator to sideload anything to verify.
#
# Each check fails the build with a loud error if a known regression
# pattern reappears.
#
# Bug classes covered:
#   1. UPDATE_PACKAGES_WITHOUT_USER_ACTION stripped from Player manifest
#      (the v1.0.21 mistake that silently broke OTA for 30+ releases)
#   2. setRequireUserAction(USER_ACTION_NOT_REQUIRED) not called on
#      Player's PackageInstaller session params (no silent-install hint)
#   3. Api31SilentInstall / Api34UpdateOwnership helper objects missing
#      or not @RequiresApi-isolated (would re-trigger the v1.0.20
#      VerifyError crash on Android 11)
#   4. setAppPackageName not pinned to Player's own package (security:
#      attacker could swap a different APK into the staging dir)
#   5. Web player's "Update complete" dedup not persisting to
#      localStorage (the splash-screen banner regression)
#   6. Player OTA worker bailing out when Manager is installed (the
#      "manager handles it" assumption that's never worked)
#
# Run locally:  bash scripts/ota-wiring-check.sh
# In CI:        already wired into .github/workflows/ota-wiring.yml
set -u  # don't -e: we want to count failures and report them all

cd "$(dirname "$0")/.."

PASS=0
FAIL=0
PLAYER_MANIFEST="apps/player/app/src/main/AndroidManifest.xml"
PLAYER_OTA="apps/player/app/src/main/java/com/educms/player/ota/OtaUpdateWorker.kt"
PLAYER_API31="apps/player/app/src/main/java/com/educms/player/ota/Api31SilentInstall.kt"
PLAYER_API34="apps/player/app/src/main/java/com/educms/player/ota/Api34UpdateOwnership.kt"
MANAGER_OTA_INSTALLER="apps/player/manager/src/main/java/com/educms/manager/OtaInstaller.kt"
WEB_PLAYER_PAGE="apps/web/src/app/player/page.tsx"

ok()  { echo "  ✓ $1"; PASS=$((PASS+1)); }
bad() { echo "  ✗ $1" >&2; FAIL=$((FAIL+1)); }

echo "=== OTA wiring integrity check ==="
echo ""

# -------- Bug class 1: UPDATE_PACKAGES_WITHOUT_USER_ACTION declared --------
if grep -qE 'uses-permission[^>]+UPDATE_PACKAGES_WITHOUT_USER_ACTION' "$PLAYER_MANIFEST"; then
    ok "Player manifest declares UPDATE_PACKAGES_WITHOUT_USER_ACTION"
else
    bad "Player manifest is MISSING UPDATE_PACKAGES_WITHOUT_USER_ACTION — silent install is BROKEN. See ota-wiring-check.sh bug class #1."
fi

if grep -qE 'uses-permission[^>]+UPDATE_PACKAGES_WITHOUT_USER_ACTION' apps/player/manager/src/main/AndroidManifest.xml; then
    ok "Manager manifest declares UPDATE_PACKAGES_WITHOUT_USER_ACTION"
else
    bad "Manager manifest is MISSING UPDATE_PACKAGES_WITHOUT_USER_ACTION"
fi

# -------- Bug class 2: setRequireUserAction wired --------
if grep -qE 'Api31SilentInstall\.configure' "$PLAYER_OTA"; then
    ok "Player OtaUpdateWorker calls Api31SilentInstall.configure"
else
    bad "Player OtaUpdateWorker does NOT call Api31SilentInstall.configure — silent install hint is missing. See bug class #2."
fi

if grep -qE 'Api31SilentInstall\.configure' "$MANAGER_OTA_INSTALLER"; then
    ok "Manager OtaInstaller calls Api31SilentInstall.configure"
else
    bad "Manager OtaInstaller does NOT call Api31SilentInstall.configure"
fi

# -------- Bug class 3: API-31/34 isolation --------
if [[ -f "$PLAYER_API31" ]]; then
    if grep -qE '@RequiresApi\(Build\.VERSION_CODES\.S\)' "$PLAYER_API31"; then
        ok "Api31SilentInstall.kt @RequiresApi(S) gated (Android 11 VerifyError safe)"
    else
        bad "Api31SilentInstall.kt MISSING @RequiresApi(S) — would crash Android 11 with VerifyError. See bug class #3."
    fi
else
    bad "Player's Api31SilentInstall.kt file does not exist"
fi

if [[ -f "$PLAYER_API34" ]]; then
    if grep -qE '@RequiresApi\(Build\.VERSION_CODES\.UPSIDE_DOWN_CAKE\)' "$PLAYER_API34"; then
        ok "Api34UpdateOwnership.kt @RequiresApi(UDC) gated"
    else
        bad "Api34UpdateOwnership.kt MISSING @RequiresApi(UDC) — VerifyError on older Android"
    fi
else
    bad "Player's Api34UpdateOwnership.kt file does not exist"
fi

# Cross-check: the call-site itself MUST gate behind a runtime check
if grep -qE 'Build\.VERSION\.SDK_INT\s*>=\s*Build\.VERSION_CODES\.S' "$PLAYER_OTA"; then
    ok "Player OtaUpdateWorker gates Api31SilentInstall behind Build.VERSION.SDK_INT >= S"
else
    bad "Player OtaUpdateWorker calls Api31SilentInstall without runtime SDK check — VerifyError risk"
fi

# -------- Bug class 4: setAppPackageName pinned --------
if grep -qE 'params\.setAppPackageName\(ctx\.packageName\)' "$PLAYER_OTA"; then
    ok "Player install pins setAppPackageName to ctx.packageName"
else
    bad "Player install does NOT pin setAppPackageName — APK-swap attack vector. See bug class #4."
fi

# -------- Bug class 5: web dedup persists to localStorage --------
if grep -qE "localStorage\.setItem\(['\"]edu\.ota\.lastInstalledAt['\"]" "$WEB_PLAYER_PAGE"; then
    ok "Web player persists OTA dedup key to localStorage"
else
    bad "Web player does NOT persist OTA dedup key — splash-screen banner will re-fire on every nav. See bug class #5."
fi

if grep -qE "localStorage\.getItem\(['\"]edu\.ota\.lastInstalledAt['\"]" "$WEB_PLAYER_PAGE"; then
    ok "Web player hydrates OTA dedup key from localStorage on mount"
else
    bad "Web player does NOT hydrate OTA dedup key from localStorage"
fi

# -------- Bug class 6: Player doesn't bail when Manager installed --------
# The bailing-out pattern was a literal early return when isManagerInstalled
# was true. Catch that pattern specifically. Use awk to look at the
# surrounding 3 lines after the `if (isManagerInstalled` to see if it
# returns Result.success early.
if awk '/isManagerInstalled\(applicationContext\)/{found=1; line=NR}
        found && NR > line && NR <= line+5 && /return@withContext Result\.success/{print "FOUND"; exit}' \
        "$PLAYER_OTA" | grep -q "FOUND"; then
    bad "Player OTA worker EARLY-RETURNS when Manager is installed — silently breaks OTA. See bug class #6."
else
    ok "Player OTA worker no longer bails when Manager is installed"
fi

echo ""
echo "=== Result: $PASS passed, $FAIL failed ==="
if [[ "$FAIL" -gt 0 ]]; then
    echo ""
    echo "OTA wiring is BROKEN. One or more checks above failed — see bug class refs."
    echo "Until fixed, remote OTA updates WILL silently fail on operator kiosks."
    exit 1
fi
exit 0
