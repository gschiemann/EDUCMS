#!/usr/bin/env bash
#
# display-capability-probe.sh — READ-ONLY, machine-readable capability
# verdict for ONE Android signage box. The adb twin of the in-app
# DisplayCapabilityProbe.kt.
#
# NOT the same tool as scripts/vendor-display-probe.sh. That one is the
# DEEP RECON tool: it dumps everything (binder services, vendor manifests,
# settings namespaces, optional APK pulls) into scratch/ and writes a
# human summary you paste back into a session. This one answers a single
# narrow question — "what will the dashboard be able to drive on this
# unit?" — in --human, --kv and --json form, so provision-kiosk.sh and
# fleet-display-probe.sh can consume it. Keep both.
#
# ─────────────────────────────────────────────────────────────────────
# SAFETY CONTRACT — THIS SCRIPT CANNOT CHANGE THE DEVICE.
# ─────────────────────────────────────────────────────────────────────
# Every command is a read: getprop, dumpsys, pm list, appops get, ls,
# cat. There is no `settings put`, no `setprop`, no `service call`, no
# `am broadcast`, no `dpm`, no `pm install`, no write to /sys. Safe on a
# live screen, mid-day, in front of customers.
#
# USAGE
#   scripts/display-capability-probe.sh                   # human report
#   scripts/display-capability-probe.sh --serial ABC123
#   scripts/display-capability-probe.sh --kv              # key=value lines
#   scripts/display-capability-probe.sh --json            # one JSON object
#
# OPTIONS
#   --serial S, -s S   target this device (else: the only one connected)
#   --kv               key=value on stdout, nothing else. Machine format.
#   --json             a single JSON object on stdout. Machine format.
#   --human            the default; a readable verdict block.
#   -h, --help         this text
#
# EXIT CODES
#   0  probed
#   2  usage / adb missing / no unique device / device unreachable
#
# See docs/FIELD-PROVISIONING.md.
#
set -uo pipefail

MGR_PKG_BASE="com.educms.manager"
PLR_PKG_BASE="com.educms.player"

SERIAL=""
MODE="human"

usage() { sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --serial|-s) SERIAL="${2:-}"; shift 2 || usage 2 ;;
    --kv)        MODE="kv"; shift ;;
    --json)      MODE="json"; shift ;;
    --human)     MODE="human"; shift ;;
    -h|--help)   usage 0 ;;
    *)           printf 'unknown argument: %s\n' "$1" >&2; usage 2 ;;
  esac
done

command -v adb >/dev/null 2>&1 || { printf 'adb not found on PATH\n' >&2; exit 2; }

if [ -z "$SERIAL" ]; then
  SERIALS="$(adb devices 2>/dev/null | awk 'NR>1 && $2=="device" {print $1}')"
  N="$(printf '%s\n' "$SERIALS" | grep -c .)"
  if [ "$N" -ne 1 ]; then
    printf 'need exactly ONE device connected (found %s) — use --serial\n' "$N" >&2
    adb devices >&2
    exit 2
  fi
  SERIAL="$(printf '%s\n' "$SERIALS" | head -1)"
fi

adb -s "$SERIAL" get-state >/dev/null 2>&1 \
  || { printf 'device %s is not reachable\n' "$SERIAL" >&2; exit 2; }

# shq <one-shell-string> — run ONE command string on the DEVICE shell.
#
# The argument is deliberately a single already-quoted string: any glob
# inside it must reach the device unexpanded. An UNQUOTED glob here would
# be expanded by the FIELD TECH'S LAPTOP first (silently correct on macOS,
# where /sys/class/backlight does not exist, and silently WRONG on a Linux
# laptop, which has one) — the laptop's node names would be sent to the
# panel and the brightness verdict would depend on the tech's OS.
shq() { adb -s "$SERIAL" shell "$1" 2>/dev/null | tr -d '\r'; }
gp()  { shq "getprop $1"; }

# ── identity ────────────────────────────────────────────────────────
MANUFACTURER="$(gp ro.product.manufacturer)"
MODEL="$(gp ro.product.model)"
BOARD="$(gp ro.board.platform)"
ANDROID_REL="$(gp ro.build.version.release)"
SDK="$(gp ro.build.version.sdk)"
BUILD_ID="$(gp ro.build.id)"
[ -n "$BUILD_ID" ] || BUILD_ID="$(gp ro.build.display.id)"

# ── our packages ────────────────────────────────────────────────────
PKG_LIST="$(shq 'pm list packages' | sed 's/^package://')"
pkg_resolve() { printf '%s\n' "$PKG_LIST" | grep -E "^$1(\.debug)?$" | head -1; }

MGR_PKG="$(pkg_resolve "$MGR_PKG_BASE")"
PLR_PKG="$(pkg_resolve "$PLR_PKG_BASE")"
MANAGER_INSTALLED=no; [ -n "$MGR_PKG" ] && MANAGER_INSTALLED=yes
PLAYER_INSTALLED=no;  [ -n "$PLR_PKG" ] && PLAYER_INSTALLED=yes

ver_of() { [ -n "$1" ] || { printf '%s' "-"; return; }
  shq "dumpsys package $1" | grep -m1 'versionName=' | sed 's/.*versionName=//' | awk '{print $1}'; }
MANAGER_VERSION="$(ver_of "$MGR_PKG")"; [ -n "$MANAGER_VERSION" ] || MANAGER_VERSION="-"
PLAYER_VERSION="$(ver_of "$PLR_PKG")";  [ -n "$PLAYER_VERSION" ]  || PLAYER_VERSION="-"

# Installer of record. Matters for OTA: an updater can only ever install
# over a package it "owns", and on API 31+ silent update additionally
# requires the updater to be that installer. On API < 31 it changes
# nothing — see docs/FIELD-PROVISIONING.md §7.
PLAYER_INSTALLER="-"
if [ -n "$PLR_PKG" ]; then
  PLAYER_INSTALLER="$(shq "pm list packages -i $PLR_PKG" \
    | grep -m1 "package:$PLR_PKG" | sed -n 's/.*installer=//p')"
  [ -n "$PLAYER_INSTALLER" ] || PLAYER_INSTALLER="none"
fi

# ── device policy: owner + ACTIVE ADMINS ────────────────────────────
DP="$(shq 'dumpsys device_policy')"
# Only the 4 lines that FOLLOW a "Device Owner" header, and only a
# ComponentInfo{pkg/Class} inside that window, count as an owner.
#
# Deliberately strict: some ROMs print the header with `null` / `none`
# under it even when no owner is set, and the very next block is the
# ACTIVE ADMIN list. A looser match there would read a plain device
# admin (ours or the vendor's) as a device OWNER — which would make the
# script claim remote reboot exists, and would make it skip steps that
# still need running. Wrong in the dangerous direction.
DO_WINDOW="$(printf '%s\n' "$DP" | grep -iA4 'Device Owner')"
DO_PKG=""
case "$DO_WINDOW" in
  *ComponentInfo\{*)
    if ! printf '%s\n' "$DO_WINDOW" | head -2 | grep -qiE 'null|none|<none>'; then
      DO_PKG="$(printf '%s\n' "$DO_WINDOW" \
        | grep -oE 'ComponentInfo\{[a-zA-Z][a-zA-Z0-9_.]*/' \
        | head -1 | sed 's/ComponentInfo{//; s#/$##')"
    fi ;;
esac

# Active device admins (NOT owners). Any package may hold one; it is
# activated by `dpm set-active-admin` over adb or by the operator tapping
# through ACTION_ADD_DEVICE_ADMIN. No factory reset involved.
ADMIN_COMPONENTS="$(printf '%s\n' "$DP" \
  | grep -oE 'ComponentInfo\{[^}]*\}' \
  | sed 's/ComponentInfo{//; s/}//' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
[ -n "$ADMIN_COMPONENTS" ] || ADMIN_COMPONENTS="none"

ADMIN_ACTIVE=no
[ "$ADMIN_COMPONENTS" != "none" ] && ADMIN_ACTIVE=yes

# An admin belonging to OUR packages is the only one that grants US
# anything: DevicePolicyManager scopes lockNow() to the CALLING package,
# so a vendor CMS's admin is worth exactly zero to us. This is
# deliberately stricter than "activeAdminCount > 0".
ADMIN_OURS=no
case "$ADMIN_COMPONENTS" in
  *"$MGR_PKG_BASE"*|*"$PLR_PKG_BASE"*) ADMIN_OURS=yes ;;
esac

DO_IS_OURS=no
case "$DO_PKG" in
  "$MGR_PKG_BASE"|"$MGR_PKG_BASE".debug|"$PLR_PKG_BASE"|"$PLR_PKG_BASE".debug) DO_IS_OURS=yes ;;
esac

ACCOUNTS="$(shq 'dumpsys account' | grep -c 'Account {')"
[ -n "$ACCOUNTS" ] || ACCOUNTS=0
USERS="$(shq 'pm list users' | grep -c 'UserInfo{')"
[ -n "$USERS" ] || USERS=0

# deviceOwnerPath — EXACTLY the three values the rest of the stack knows
# (packages/api-types/src/display-control.ts DEVICE_OWNER_PATHS, and
# DisplayCapabilityProbe.kt). A field script that invented a fourth value
# made the dashboard and the field table disagree about the same serial;
# the "the window is open" fact now rides its own key below instead.
if [ "$DO_IS_OURS" = yes ]; then
  DO_PATH="held"
elif [ -n "$DO_PKG" ]; then
  DO_PATH="blocked-other-owner"
else
  DO_PATH="provisionable-after-factory-reset"
fi

# Would `dpm set-device-owner` be accepted RIGHT NOW? Field-only fact,
# never sent to the dashboard. Android accepts it only with no other
# owner, no accounts and a single user.
DO_WINDOW_OPEN=no
if [ -z "$DO_PKG" ] && [ "${ACCOUNTS:-0}" -eq 0 ] && [ "${USERS:-0}" -le 1 ]; then
  DO_WINDOW_OPEN=yes
fi

# ── audio ───────────────────────────────────────────────────────────
VOLUME=none
if [ -n "$(shq 'dumpsys audio' | head -3)" ]; then VOLUME=audiomanager; fi

# ── backlight sysfs ─────────────────────────────────────────────────
# NOTE the single-quoted device command: the globs below are expanded by
# the PANEL, never by the laptop. See shq() above.
# shellcheck disable=SC2016  # single quotes are the POINT: $d and the globs
#                             must reach the DEVICE shell unexpanded.
BL_NODES="$(shq 'for d in /sys/class/backlight/*/ /sys/class/leds/lcd-backlight/ /sys/class/leds/*backlight*/; do [ -f "$d/brightness" ] && echo "$d"; done' | sort -u)"
SYSFS_NODE="-"
SYSFS_MODE="-"
SYSFS_WORLD_WRITABLE=no
if [ -n "$BL_NODES" ]; then
  while IFS= read -r d; do
    [ -n "$d" ] || continue
    ls_line="$(shq "ls -l ${d}brightness 2>/dev/null" | head -1)"
    perms="$(printf '%s' "$ls_line" | awk '{print $1}')"
    [ -n "$perms" ] || continue
    others_w="$(printf '%s' "$perms" | cut -c9)"
    if [ "$SYSFS_NODE" = "-" ]; then
      SYSFS_NODE="${d}brightness"
      SYSFS_MODE="$perms"
    fi
    if [ "$others_w" = "w" ]; then
      # A world-writable node is the only one our ordinary uid can drive.
      SYSFS_NODE="${d}brightness"
      SYSFS_MODE="$perms"
      SYSFS_WORLD_WRITABLE=yes
      break
    fi
  done <<EOF
$BL_NODES
EOF
fi

# ── WRITE_SETTINGS (the Settings.System brightness path) ────────────
WS_DECLARED=no
WS_APPOP="-"
if [ -n "$PLR_PKG" ]; then
  shq "dumpsys package $PLR_PKG" | grep -q 'android.permission.WRITE_SETTINGS' && WS_DECLARED=yes
  raw="$(shq "appops get $PLR_PKG WRITE_SETTINGS")"
  case "$raw" in
    *allow*)  WS_APPOP=allow ;;
    *ignore*) WS_APPOP=ignore ;;
    *deny*)   WS_APPOP=deny ;;
    *default*) WS_APPOP=default ;;
    "")       WS_APPOP="unset" ;;   # quoted: `unset` is a shell builtin (SC2209)
    *)        WS_APPOP="$(printf '%s' "$raw" | head -1 | tr -d ' ')" ;;
  esac
fi

# ── battery optimisation ────────────────────────────────────────────
# A doze-throttled player misses its AlarmManager on/off schedule by
# minutes to hours. Exemption is grantable over adb without ownership.
BATTERY_OPT_EXEMPT=unknown
if [ -n "$PLR_PKG" ]; then
  wl="$(shq 'dumpsys deviceidle whitelist')"
  if [ -n "$wl" ]; then
    if printf '%s\n' "$wl" | grep -q "$PLR_PKG"; then
      BATTERY_OPT_EXEMPT=yes
    else
      BATTERY_OPT_EXEMPT=no
    fi
  fi
fi

# ── serial ──────────────────────────────────────────────────────────
SERIAL_PORTS="$(shq 'ls /dev/ttyUSB* /dev/ttyS* /dev/ttyACM* 2>/dev/null' \
  | grep -E '^/dev/tty' | sort -u | tr '\n' ' ' | sed 's/ *$//')"
[ -n "$SERIAL_PORTS" ] || SERIAL_PORTS="none"

# ── vendor auto-start manager (Chinese ROM startup whitelist) ───────
# UNVERIFIED HEURISTIC — a name match, nothing more. These ROMs ship a
# proprietary "auto start / startup management" app separate from
# Android's own settings, and an app that is not ticked there is killed
# after boot no matter what BootReceiver does. Confirm by hand on the
# panel; see docs/FIELD-PROVISIONING.md §6a.
VENDOR_AUTOSTART_HINT="$(shq 'pm list packages -s' | sed 's/^package://' \
  | grep -iE 'autostart|auto_start|startup|selfstart|bootmanager|boot_manager|goodview|^com\.gv\.' \
  | sort -u | tr '\n' ' ' | sed 's/ *$//')"
[ -n "$VENDOR_AUTOSTART_HINT" ] || VENDOR_AUTOSTART_HINT="none-matched"

# ════════════════════════════════════════════════════════════════════
#  VERDICT — the mechanism the dashboard will drive, per capability.
#  These token sets match DisplayCapabilityProbe.kt exactly. Do not
#  invent a new token here without adding it to the Kotlin probe, the
#  API allowlist and the web allowlist in the same wave.
# ════════════════════════════════════════════════════════════════════

# BRIGHTNESS — most-real mechanism first. software-dim ALWAYS works.
if [ "$SYSFS_WORLD_WRITABLE" = yes ]; then
  BRIGHTNESS="sysfs"
elif [ "$WS_DECLARED" = yes ] && [ "$WS_APPOP" = "allow" ]; then
  BRIGHTNESS="settings"
else
  BRIGHTNESS="software-dim"
fi

# BLANK/WAKE — the verdict names the MECHANISM, not the availability.
# Blank and wake are ALWAYS available on every box: the software floor
# (window brightness + a full-screen black overlay) cannot fail. `none`
# below means "software overlay only" — image goes black, backlight
# stays lit, no power saving. It does NOT mean "no blank button".
if [ "$DO_IS_OURS" = yes ]; then
  SCREEN_BLANK="device-owner"
elif [ "$ADMIN_OURS" = yes ]; then
  SCREEN_BLANK="device-admin"
else
  SCREEN_BLANK="none"
fi

# REBOOT — device owner ONLY. No fallback exists at any privilege level
# short of a manufacturer preinstall (platform-signed system app).
if [ "$DO_IS_OURS" = yes ]; then REBOOT="device-owner"; else REBOOT="none"; fi

# HARD POWER-OFF — no public Android API at any privilege level.
if [ "$SERIAL_PORTS" != "none" ]; then HARD_POWER_OFF="serial-candidate"; else HARD_POWER_OFF="none"; fi

# ── emit ────────────────────────────────────────────────────────────
emit_kv() {
  cat <<EOF
serial=$SERIAL
manufacturer=$MANUFACTURER
model=$MODEL
board=$BOARD
android=$ANDROID_REL
sdk=$SDK
build=$BUILD_ID
managerInstalled=$MANAGER_INSTALLED
playerInstalled=$PLAYER_INSTALLED
managerVersion=$MANAGER_VERSION
playerVersion=$PLAYER_VERSION
playerInstaller=$PLAYER_INSTALLER
deviceOwnerPkg=$DO_PKG
deviceOwnerIsOurs=$DO_IS_OURS
deviceOwnerPath=$DO_PATH
deviceOwnerWindowOpen=$DO_WINDOW_OPEN
adminActive=$ADMIN_ACTIVE
adminOurs=$ADMIN_OURS
adminComponents=$ADMIN_COMPONENTS
accounts=$ACCOUNTS
users=$USERS
volume=$VOLUME
brightness=$BRIGHTNESS
screenBlank=$SCREEN_BLANK
reboot=$REBOOT
hardPowerOff=$HARD_POWER_OFF
sysfsNode=$SYSFS_NODE
sysfsMode=$SYSFS_MODE
sysfsWorldWritable=$SYSFS_WORLD_WRITABLE
writeSettingsAppop=$WS_APPOP
writeSettingsDeclared=$WS_DECLARED
batteryOptExempt=$BATTERY_OPT_EXEMPT
serialPorts=$SERIAL_PORTS
vendorAutoStartHint=$VENDOR_AUTOSTART_HINT
EOF
}

# JSON is generated FROM the kv block so the two can never drift.
emit_json() {
  emit_kv | awk '
    BEGIN { printf "{\n"; first = 1 }
    {
      eq = index($0, "=")
      if (eq == 0) next
      k = substr($0, 1, eq - 1)
      v = substr($0, eq + 1)
      gsub(/\\/, "\\\\", v)
      gsub(/"/, "\\\"", v)
      if (!first) printf ",\n"
      printf "  \"%s\": \"%s\"", k, v
      first = 0
    }
    END { printf "\n}\n" }
  '
}

emit_human() {
  rule() { printf '──────────────────────────────────────────────────────────────────────\n'; }
  echo ""
  rule
  printf '  %s %s   Android %s (SDK %s)   serial %s\n' \
    "$MANUFACTURER" "$MODEL" "$ANDROID_REL" "$SDK" "$SERIAL"
  rule
  printf '  Manager / Player installed : %s / %s   (%s / %s)\n' \
    "$MANAGER_INSTALLED" "$PLAYER_INSTALLED" "$MANAGER_VERSION" "$PLAYER_VERSION"
  printf '  device owner               : %s\n' "${DO_PKG:-<none>}"
  printf '  device-owner path          : %s\n' "$DO_PATH"
  printf '  active device admins       : %s  (ours: %s)\n' "$ADMIN_ACTIVE" "$ADMIN_OURS"
  printf '  accounts / users           : %s / %s\n' "$ACCOUNTS" "$USERS"
  printf '  WRITE_SETTINGS             : declared=%s appop=%s\n' "$WS_DECLARED" "$WS_APPOP"
  printf '  backlight node             : %s (%s, world-writable=%s)\n' \
    "$SYSFS_NODE" "$SYSFS_MODE" "$SYSFS_WORLD_WRITABLE"
  printf '  battery-opt exempt         : %s\n' "$BATTERY_OPT_EXEMPT"
  printf '  serial ports               : %s\n' "$SERIAL_PORTS"
  rule
  echo ""
  echo "  WHAT THE DASHBOARD WILL BE ABLE TO DRIVE ON THIS UNIT"
  echo ""
  case "$VOLUME" in
    audiomanager) echo "    ✓ VOLUME      real, via AudioManager. Needs no privilege at all." ;;
    *)            echo "    ✗ VOLUME      no audio service answered on this box." ;;
  esac
  case "$BRIGHTNESS" in
    sysfs)    echo "    ✓ BRIGHTNESS  real backlight — the sysfs node is world-writable." ;;
    settings) echo "    ✓ BRIGHTNESS  real, via Settings.System (WRITE_SETTINGS is allowed)." ;;
    *)        echo "    ~ BRIGHTNESS  SOFTWARE DIM ONLY. The image darkens; the LCD backlight"
              echo "                  stays lit, so there is NO power saving. The dashboard"
              echo "                  says exactly that on the slider — it is not a costume." ;;
  esac
  case "$SCREEN_BLANK" in
    device-owner) echo "    ✓ BLANK/WAKE  real screen-off via device policy (we hold device owner)." ;;
    device-admin) echo "    ✓ BLANK/WAKE  real screen-off via device admin lockNow()." ;;
    *)            echo "    ✓ BLANK/WAKE  AVAILABLE — software overlay only (black overlay +"
                  echo "                  window brightness 0). Always works, never fails, but the"
                  echo "                  backlight stays lit so there is no power saving."
                  echo "                  Activate device ADMIN to upgrade this to a real"
                  echo "                  screen-off: provision-kiosk.sh does it in one tap." ;;
  esac
  case "$REBOOT" in
    device-owner) echo "    ✓ REBOOT      available (we hold device owner)." ;;
    *)            echo "    ✗ REBOOT      NOT AVAILABLE, and by design: we do not take device"
                  echo "                  owner. No reboot control is rendered in the dashboard."
                  echo "                  A hung unit needs a human with a power cord until the"
                  echo "                  manufacturer-preinstall path lands. See §7." ;;
  esac
  echo "    ✓ SCHEDULES   on-device on/off windows via AlarmManager. Survives a"
  echo "                  network outage; needs no privilege."
  echo ""
  if [ "$DO_WINDOW_OPEN" = yes ]; then
    echo "  NOTE: this box would ACCEPT device owner right now (no owner, no"
    echo "  accounts, single user). We deliberately do NOT take it — see the"
    echo "  pivot note in docs/FIELD-PROVISIONING.md §7. --take-device-owner"
    echo "  exists if the lead explicitly decides otherwise for one unit."
    echo ""
  fi
  if [ "$VENDOR_AUTOSTART_HINT" != "none-matched" ]; then
    echo "  VENDOR AUTO-START CANDIDATES (unverified name match — confirm on the"
    echo "  panel by hand, §6a):"
    printf '    %s\n' "$VENDOR_AUTOSTART_HINT"
    echo ""
  fi
}

case "$MODE" in
  kv)    emit_kv ;;
  json)  emit_json ;;
  *)     emit_human ;;
esac
exit 0
