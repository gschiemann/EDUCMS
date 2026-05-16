#!/usr/bin/env bash
#
# provision-kiosk.sh — one-command EduCMS kiosk provisioning.
#
# WHAT THIS SOLVES
# ----------------
# For OTA updates to be truly hands-free — push from the dashboard,
# operator clicks "yes", everything else (install Player, install
# Manager, keep permissions, relaunch the app) happens automatically —
# the Manager companion app must be the device's DEVICE OWNER.
#
# An APK CANNOT make itself device owner just by being installed —
# Android forbids self-promotion (it would be a security hole). Device
# owner can only be set:
#   (a) over ADB with `dpm set-device-owner`  ← what this script does
#   (b) via QR-code provisioning at first boot (see docs/KIOSK_SETUP.md)
# and ONLY on a device with no accounts added yet (factory-fresh).
#
# So: this script IS the sideload step. Run it once, over USB, on a
# fresh kiosk, instead of `adb install`. It installs both APKs and
# provisions device owner in a single command. After that every OTA
# from the dashboard is silent + auto-relaunching.
#
# USAGE
# -----
#   scripts/provision-kiosk.sh                 # downloads latest release APKs
#   scripts/provision-kiosk.sh player.apk manager.apk   # use local APKs
#
# REQUIREMENTS
# ------------
#   - adb on PATH, exactly one device connected over USB
#   - the device is factory-fresh: NO Google account, NO other users
#     (device owner provisioning is rejected otherwise)
#   - `gh` CLI authenticated (only for the auto-download path)
#
set -euo pipefail

REPO="gschiemann/EDUCMS"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*" >&2; exit 1; }

command -v adb >/dev/null || die "adb not found on PATH"

# ── one device, please ──────────────────────────────────────────────
DEV_COUNT="$(adb devices | grep -cE '\sdevice$' || true)"
[ "$DEV_COUNT" = "1" ] || die "need exactly ONE device connected (found $DEV_COUNT)"

# ── locate the APKs ─────────────────────────────────────────────────
PLAYER_APK="${1:-}"
MANAGER_APK="${2:-}"
if [ -z "$PLAYER_APK" ]; then
  command -v gh >/dev/null || die "gh CLI not found — pass APK paths explicitly"
  say "Downloading latest Player + Manager release APKs from GitHub…"
  PTAG="$(gh release list --repo "$REPO" --limit 30 | awk '$0 ~ /player-v/ {print $1; exit}')"
  MTAG="$(gh release list --repo "$REPO" --limit 30 | awk '$0 ~ /manager-v/ {print $1; exit}')"
  [ -n "$PTAG" ] && [ -n "$MTAG" ] || die "could not find player-v* / manager-v* releases"
  gh release download "$PTAG" --repo "$REPO" --pattern '*.apk' --dir "$TMP"
  gh release download "$MTAG" --repo "$REPO" --pattern '*.apk' --dir "$TMP"
  PLAYER_APK="$(ls "$TMP"/edu-cms-player-*.apk | head -1)"
  MANAGER_APK="$(ls "$TMP"/edu-cms-manager-*.apk | head -1)"
  ok "Player  $PTAG"
  ok "Manager $MTAG"
fi
[ -f "$PLAYER_APK" ]  || die "Player APK not found: $PLAYER_APK"
[ -f "$MANAGER_APK" ] || die "Manager APK not found: $MANAGER_APK"

# ── refuse to run on a device that already has accounts ─────────────
# Device-owner provisioning will fail anyway, but failing early with a
# clear message beats a cryptic dpm error.
ACCTS="$(adb shell dumpsys account 2>/dev/null | grep -c 'Account {' || true)"
if [ "${ACCTS:-0}" != "0" ]; then
  die "device has $ACCTS account(s) configured — device owner can only be set on a factory-fresh device. Factory reset and run this BEFORE adding any account."
fi

# ── install both APKs ───────────────────────────────────────────────
say "Installing Manager…"
adb install -r -g "$MANAGER_APK" >/dev/null && ok "Manager installed"
say "Installing Player…"
adb install -r -g "$PLAYER_APK" >/dev/null && ok "Player installed"

# Resolve the Manager package id actually installed (release vs .debug).
MGR_PKG="$(adb shell pm list packages | sed 's/package://' | tr -d '\r' \
  | grep -E '^com\.educms\.manager(\.debug)?$' | head -1)"
[ -n "$MGR_PKG" ] || die "Manager package not found after install"
ok "Manager package: $MGR_PKG"

# ── provision device owner ──────────────────────────────────────────
say "Setting Manager as device owner…"
ADMIN="$MGR_PKG/com.educms.manager.AdminReceiver"
if adb shell dpm set-device-owner "$ADMIN" 2>&1 | grep -q 'Success'; then
  ok "Device owner set — $ADMIN"
else
  die "dpm set-device-owner failed. The device must be factory-fresh with no accounts. Factory reset and retry."
fi

# ── verify ──────────────────────────────────────────────────────────
if adb shell dumpsys device_policy 2>/dev/null | grep -q "Device Owner"; then
  ok "Verified: device owner is active"
fi

cat <<'DONE'

──────────────────────────────────────────────────────────────────────
 Kiosk provisioned.

 From now on, OTA updates pushed from the dashboard are fully
 hands-free on THIS device:
   • Player + Manager install silently (no "Install?" dialog)
   • permissions are already granted (device owner holds them)
   • the Player relaunches itself after the update

 Repeat this script on each new kiosk, on a factory-fresh device,
 before adding any account.
──────────────────────────────────────────────────────────────────────
DONE
