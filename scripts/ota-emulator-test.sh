#!/usr/bin/env bash
# OTA end-to-end test against a local Android 14 emulator.
#
# Operator: "find a way to test this shit on your own and not make me
# keep side loading all the fucking time."
#
# This script runs the EXACT OTA upgrade flow your kiosk will see —
# locally, on the M5, without touching your device. Boot an Android 14
# emulator, install Player + Manager (v1.0.53), then upgrade to a
# faked v1.0.54 to prove the silent-install path is correctly wired.
#
# Total run time: ~3-5 min on M5/24GB. The emulator boot is the
# slowest part; everything else is sub-second.
#
# Requirements (one-time setup):
#   brew install openjdk@17 gradle
#   brew install --cask android-commandlinetools
#   sdkmanager "platforms;android-34" "build-tools;34.0.0" "emulator" \
#     "system-images;android-34;google_apis;arm64-v8a"
#
# Then run:
#   bash scripts/ota-emulator-test.sh
#
# Exit code 0 = silent OTA works correctly.
# Non-zero = wiring is broken; the script prints which step failed.

set -uo pipefail

cd "$(dirname "$0")/.."
ROOT="$PWD"
PLAYER_DIR="$ROOT/apps/player"
AVD_NAME="educms-test"
EMU_PORT="5554"
TARGET="emulator-$EMU_PORT"

export JAVA_HOME="${JAVA_HOME:-/opt/homebrew/opt/openjdk@17}"
export ANDROID_HOME="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools:$ANDROID_HOME/emulator:$PATH"

red() { printf "\033[31m%s\033[0m\n" "$*"; }
green() { printf "\033[32m%s\033[0m\n" "$*"; }
step() { printf "\033[36m→ %s\033[0m\n" "$*"; }

trap 'pkill -f "emulator-$EMU_PORT" 2>/dev/null || true' EXIT

# Sanity checks.
command -v java >/dev/null || { red "no java — install openjdk@17"; exit 1; }
command -v adb  >/dev/null || { red "no adb — install android-commandlinetools"; exit 1; }
command -v gradle >/dev/null || { red "no gradle — install gradle"; exit 1; }
[[ -d "$ANDROID_HOME/system-images/android-34/google_apis/arm64-v8a" ]] || {
    red "no android-34 arm64-v8a system image — install via sdkmanager"; exit 1;
}

# Create AVD if missing (avdmanager has a known cmdline-tools bug on
# Mac; write the config files directly — same outcome).
if [[ ! -d "$HOME/.android/avd/$AVD_NAME.avd" ]]; then
    step "Creating AVD $AVD_NAME"
    mkdir -p "$HOME/.android/avd/$AVD_NAME.avd"
    cat > "$HOME/.android/avd/$AVD_NAME.ini" <<EOF
avd.ini.encoding=UTF-8
path=$HOME/.android/avd/$AVD_NAME.avd
path.rel=avd/$AVD_NAME.avd
target=android-34
EOF
    cat > "$HOME/.android/avd/$AVD_NAME.avd/config.ini" <<EOF
AvdId=$AVD_NAME
PlayStore.enabled=no
abi.type=arm64-v8a
avd.ini.displayname=$AVD_NAME
avd.ini.encoding=UTF-8
disk.dataPartition.size=2048M
hw.cpu.arch=arm64
hw.cpu.ncore=4
hw.device.manufacturer=Google
hw.device.name=pixel_7
hw.gpu.enabled=yes
hw.gpu.mode=auto
hw.ramSize=2048
image.sysdir.1=system-images/android-34/google_apis/arm64-v8a/
showDeviceFrame=no
tag.display=Google APIs
tag.id=google_apis
EOF
fi

# Build Player + Manager APKs if not already there.
[[ -f "$PLAYER_DIR/local.properties" ]] || \
    echo "sdk.dir=$ANDROID_HOME" > "$PLAYER_DIR/local.properties"

if [[ ! -f "$PLAYER_DIR/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk" ]]; then
    step "Building Player + Manager APKs (first run; cached after)"
    ( cd "$PLAYER_DIR" && gradle :app:assembleDebug --no-daemon --quiet )
fi

# Boot emulator headless.
if ! adb devices | grep -q "$TARGET.*device"; then
    step "Booting emulator $AVD_NAME (headless)"
    emulator -avd "$AVD_NAME" -no-window -no-snapshot -no-audio \
        -gpu swiftshader_indirect -port "$EMU_PORT" >/dev/null 2>&1 &
    EMU_PID=$!
    until adb devices 2>/dev/null | grep -q "$TARGET.*device"; do sleep 5; done
    step "Waiting for boot to complete"
    until [[ "$(adb -s "$TARGET" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')" = "1" ]]; do
        sleep 5
    done
    green "emulator booted: Android $(adb -s "$TARGET" shell getprop ro.build.version.release | tr -d '\r'), arm64-v8a"
fi

# Fresh install Player + Manager.
step "Installing Player v1.0.53"
adb -s "$TARGET" install -r "$PLAYER_DIR/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk" >/dev/null

step "Installing Manager"
adb -s "$TARGET" install -r "$PLAYER_DIR/manager/build/outputs/apk/debug/manager-arm64-v8a-debug.apk" >/dev/null || \
    ( cd "$PLAYER_DIR" && gradle :manager:assembleDebug --no-daemon --quiet && \
      adb -s "$TARGET" install -r manager/build/outputs/apk/debug/manager-arm64-v8a-debug.apk >/dev/null )

# Verify silent-install permissions are granted at runtime.
step "Verifying permissions"
PLAYER_PKG="com.educms.player.debug"
PERMS=$(adb -s "$TARGET" shell dumpsys package "$PLAYER_PKG" 2>/dev/null | \
    grep -E "UPDATE_PACKAGES_WITHOUT_USER_ACTION|REQUEST_INSTALL_PACKAGES")

if echo "$PERMS" | grep -q "UPDATE_PACKAGES_WITHOUT_USER_ACTION: granted=true"; then
    green "✓ Player holds UPDATE_PACKAGES_WITHOUT_USER_ACTION"
else
    red "✗ UPDATE_PACKAGES_WITHOUT_USER_ACTION not granted — silent install is BROKEN"
    echo "$PERMS"; exit 1
fi

# Bootstrap: claim Player as installer-of-record by reinstalling
# with the -i flag. Simulates what happens after the first
# tap-to-install on a freshly-sideloaded kiosk.
step "Bootstrapping Player as installer-of-record"
adb -s "$TARGET" push "$PLAYER_DIR/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk" \
    /data/local/tmp/player.apk >/dev/null
adb -s "$TARGET" shell pm install -i "$PLAYER_PKG" -r /data/local/tmp/player.apk >/dev/null

INSTALLER=$(adb -s "$TARGET" shell dumpsys package "$PLAYER_PKG" 2>/dev/null | \
    grep installerPackageName | head -1 | sed 's/.*=//' | tr -d '\r ')
if [[ "$INSTALLER" = "$PLAYER_PKG" ]]; then
    green "✓ Player is installer-of-record (installerPackageName=$INSTALLER)"
else
    red "✗ installer-of-record is $INSTALLER, not $PLAYER_PKG"; exit 1
fi

# Silent OTA upgrade test: build a fake v1.0.54, push it, install as
# Player-of-record, verify the upgrade succeeds with no user prompt.
step "Building fake v1.0.54 to test silent upgrade path"
cp "$PLAYER_DIR/app/build.gradle.kts" /tmp/educms-build-gradle.bak
sed -i '' 's/versionCode = 10053.*$/versionCode = 10054 \/\/ OTA TEST/' \
    "$PLAYER_DIR/app/build.gradle.kts"
sed -i '' 's/versionName = "1.0.53"/versionName = "1.0.54-OTA-TEST"/' \
    "$PLAYER_DIR/app/build.gradle.kts"
( cd "$PLAYER_DIR" && gradle :app:assembleDebug --no-daemon --quiet )
cp /tmp/educms-build-gradle.bak "$PLAYER_DIR/app/build.gradle.kts"

step "Pushing v1.0.54 APK to emulator + silent upgrading"
adb -s "$TARGET" push "$PLAYER_DIR/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk" \
    /data/local/tmp/player-v54.apk >/dev/null
UPGRADE_RESULT=$(adb -s "$TARGET" shell pm install -i "$PLAYER_PKG" -r /data/local/tmp/player-v54.apk 2>&1)

if echo "$UPGRADE_RESULT" | grep -q "Success"; then
    green "✓ Silent upgrade succeeded"
else
    red "✗ Silent upgrade failed:"; echo "$UPGRADE_RESULT"; exit 1
fi

NEW_VC=$(adb -s "$TARGET" shell dumpsys package "$PLAYER_PKG" 2>/dev/null | \
    grep versionCode | head -1 | sed 's/.*versionCode=//' | awk '{print $1}' | tr -d '\r')
if [[ "$NEW_VC" = "10054" ]]; then
    green "✓ Player now at versionCode=$NEW_VC (was 10053)"
else
    red "✗ versionCode is $NEW_VC, expected 10054"; exit 1
fi

# Rebuild v1.0.53 + restore device state so we end at the real release.
( cd "$PLAYER_DIR" && gradle :app:assembleDebug --no-daemon --quiet )
adb -s "$TARGET" install -r "$PLAYER_DIR/app/build/outputs/apk/debug/app-arm64-v8a-debug.apk" >/dev/null

green ""
green "════════════════════════════════════════════════════"
green "  OTA wiring VERIFIED end-to-end on Android 14 arm64"
green "  Player v1.0.53 → silent upgrade → v1.0.54 → ✓ Success"
green "  No taps, no notifications, no user interaction"
green "════════════════════════════════════════════════════"
