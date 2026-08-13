#!/usr/bin/env bash
#
# provision-kiosk.sh — one-command EduCMS kiosk provisioning, with a
# read-only preflight, an explicit confirmation gate, and a capability
# probe on the way out.
#
# WHAT THIS SOLVES
# ----------------
# Two things, and they share one irreversible window:
#
#  1. SILENT OTA. For dashboard-pushed updates to be hands-free, the
#     Manager companion app must be the device's DEVICE OWNER.
#  2. REMOTE DISPLAY CONTROL. Remote REBOOT is device-owner-only. There
#     is no fallback, at all, on any Android box. Blank/volume/dim have
#     fallbacks; reboot does not.
#
# An APK cannot make itself device owner — Android forbids it. Device
# owner can only be taken:
#     (a) over ADB with `dpm set-device-owner`   ← what this script does
#     (b) via QR provisioning at first boot
# and ONLY while the device has no accounts and no extra users. After
# that, the ONLY way to take it is a FACTORY RESET — which on a Goodview
# panel also WIPES THE VENDOR CMS CONFIGURATION (network profile, panel
# timers, input mapping, anything the installer set up in the vendor UI).
#
# So: the physical install trip is the one window. This script is built
# to make that trip foolproof.
#
# USAGE
# -----
#   scripts/provision-kiosk.sh                      # latest release APKs
#   scripts/provision-kiosk.sh player.apk manager.apk
#   scripts/provision-kiosk.sh --serial ABC123
#   scripts/provision-kiosk.sh --dry-run            # preflight + plan only
#   scripts/provision-kiosk.sh --no-device-owner    # limited mode, vendor owns DO
#   scripts/provision-kiosk.sh --yes                # skip the typed confirm
#
# OPTIONS
#   --serial S               target this device (else: the only one connected)
#   --player PATH            Player APK
#   --manager PATH           Manager APK
#   --dry-run                report + print the plan, change NOTHING
#   --yes, -y                skip the typed confirmation (scripted re-runs)
#   --no-device-owner        install + appops only; never touch device policy
#   --require-device-owner   fail loudly if device owner cannot be taken
#   --skip-probe             don't run the capability probe at the end
#   --repo OWNER/NAME        GitHub repo for the release download
#
# WHAT THIS SCRIPT WILL NEVER DO
#   • factory reset a device
#   • uninstall Player or Manager (that would lose the screen's pairing)
#   • remove or replace an existing device owner
#   • reboot the unit
#   Every one of those is a human decision, made on site, with the
#   runbook in hand: docs/FIELD-PROVISIONING.md
#
# REQUIREMENTS
#   - adb on PATH; the device visible in `adb devices`
#   - `gh` CLI authenticated (only for the auto-download path)
#
# EXIT CODES
#   0 provisioned (or already provisioned — this script is idempotent)
#   1 a step failed
#   2 usage / environment error
#   3 refused: destructive step not confirmed
#
set -uo pipefail

REPO="gschiemann/EDUCMS"
MGR_PKG_BASE="com.educms.manager"
PLR_PKG_BASE="com.educms.player"
HERE="$(cd "$(dirname "$0")" && pwd)"
PROBE="$HERE/vendor-display-probe.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$1" >&2; exit "${2:-1}"; }
rule() { printf '──────────────────────────────────────────────────────────────────────\n'; }

usage() { sed -n '2,60p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ── args ────────────────────────────────────────────────────────────
SERIAL=""
PLAYER_APK=""
MANAGER_APK=""
DRY_RUN=0
ASSUME_YES=0
NO_DEVICE_OWNER=0
REQUIRE_DEVICE_OWNER=0
SKIP_PROBE=0
POSITIONAL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --serial|-s)            SERIAL="${2:-}"; shift 2 || usage 2 ;;
    --player)               PLAYER_APK="${2:-}"; shift 2 || usage 2 ;;
    --manager)              MANAGER_APK="${2:-}"; shift 2 || usage 2 ;;
    --repo)                 REPO="${2:-}"; shift 2 || usage 2 ;;
    --dry-run|--check)      DRY_RUN=1; shift ;;
    --yes|-y)               ASSUME_YES=1; shift ;;
    --no-device-owner)      NO_DEVICE_OWNER=1; shift ;;
    --require-device-owner) REQUIRE_DEVICE_OWNER=1; shift ;;
    --skip-probe)           SKIP_PROBE=1; shift ;;
    -h|--help)              usage 0 ;;
    -*)                     printf 'unknown argument: %s\n' "$1" >&2; usage 2 ;;
    *)                      POSITIONAL="$POSITIONAL $1"; shift ;;
  esac
done

# back-compat: provision-kiosk.sh player.apk manager.apk
if [ -n "$POSITIONAL" ]; then
  # shellcheck disable=SC2086
  set -- $POSITIONAL
  [ -n "$PLAYER_APK" ]  || PLAYER_APK="${1:-}"
  [ -n "$MANAGER_APK" ] || MANAGER_APK="${2:-}"
fi

if [ "$NO_DEVICE_OWNER" = 1 ] && [ "$REQUIRE_DEVICE_OWNER" = 1 ]; then
  die "--no-device-owner and --require-device-owner contradict each other" 2
fi

command -v adb >/dev/null 2>&1 || die "adb not found on PATH" 2
[ -f "$PROBE" ] || die "missing $PROBE — the capability probe ships alongside this script" 2

# ── resolve exactly one device ──────────────────────────────────────
if [ -z "$SERIAL" ]; then
  SERIALS="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
  N="$(printf '%s\n' "$SERIALS" | grep -c .)"
  if [ "$N" -ne 1 ]; then
    adb devices >&2
    die "need exactly ONE device connected (found $N) — use --serial" 2
  fi
  SERIAL="$(printf '%s\n' "$SERIALS" | head -1)"
fi
ADB=(adb -s "$SERIAL")
"${ADB[@]}" get-state >/dev/null 2>&1 || die "device $SERIAL is not reachable" 2
sh_() { "${ADB[@]}" shell "$@" 2>/dev/null | tr -d '\r'; }

# ════════════════════════════════════════════════════════════════════
#  STAGE 1 — PREFLIGHT.  READ ONLY.  Nothing on the device changes.
# ════════════════════════════════════════════════════════════════════
say "Preflight (read-only) on ${SERIAL}…"
KV="$TMP/preflight.kv"
bash "$PROBE" --serial "$SERIAL" --kv > "$KV" 2>"$TMP/probe.err" \
  || die "capability probe failed: $(head -1 "$TMP/probe.err")"
pv() { grep "^$1=" "$KV" 2>/dev/null | head -1 | cut -d= -f2-; }

MANUFACTURER="$(pv manufacturer)"; MODEL="$(pv model)"
ANDROID_REL="$(pv android)";       SDK="$(pv sdk)"
DO_PKG="$(pv deviceOwnerPkg)";     DO_IS_OURS="$(pv deviceOwnerIsOurs)"
DO_PATH="$(pv deviceOwnerPath)";   ACCOUNTS="$(pv accounts)"; USERS="$(pv users)"
V_BRIGHT="$(pv brightness)";       V_BLANK="$(pv screenBlank)"
V_VOL="$(pv volume)"
WS_APPOP="$(pv writeSettingsAppop)"; WS_DECL="$(pv writeSettingsDeclared)"

echo ""
rule
printf '  UNIT   %s %s   Android %s (SDK %s)   serial %s\n' \
  "$MANUFACTURER" "$MODEL" "$ANDROID_REL" "$SDK" "$SERIAL"
rule
printf '  device owner        : %s\n' "${DO_PKG:-<none>}"
printf '  …ours?              : %s\n' "$DO_IS_OURS"
printf '  device-owner path   : %s\n' "$DO_PATH"
printf '  accounts / users    : %s / %s\n' "$ACCOUNTS" "$USERS"
printf '  Manager installed   : %s\n' "$(pv managerInstalled)"
printf '  Player  installed   : %s\n' "$(pv playerInstalled)"
printf '  brightness path     : %s\n' "$V_BRIGHT"
printf '  blank path          : %s\n' "$V_BLANK"
printf '  WRITE_SETTINGS      : declared=%s appop=%s\n' "$WS_DECL" "$WS_APPOP"
rule

# ── what this unit will and will not be able to do ──────────────────
echo ""
echo "  WHAT THIS UNIT WILL BE ABLE TO DO AFTER THIS SCRIPT"
echo ""
case "$V_VOL" in
  audiomanager) echo "    ✓ VOLUME      real, via AudioManager. Works with or without device owner." ;;
  *)            echo "    ✗ VOLUME      no audio service found on this box." ;;
esac
case "$V_BRIGHT" in
  sysfs)    echo "    ✓ BRIGHTNESS  real backlight (sysfs node is world-writable)." ;;
  settings) echo "    ✓ BRIGHTNESS  real, via Settings.System — this script grants the" ;;
  *)        echo "    ~ BRIGHTNESS  SOFTWARE DIM ONLY. The image darkens; the LCD" ;;
esac
[ "$V_BRIGHT" = "settings" ] && echo "                  WRITE_SETTINGS appop that makes it work."
[ "$V_BRIGHT" = "software-dim" ] && {
  echo "                  backlight stays lit, so there is NO power saving."
  echo "                  The dashboard will say exactly that — it will not"
  echo "                  pretend this box has backlight control."
}
echo "    ✓ BLANK/WAKE  always available: device policy when we hold it,"
echo "                  otherwise a full-screen black overlay (composition only)."
if [ "$NO_DEVICE_OWNER" = 1 ] || [ "$DO_PATH" = "blocked-other-owner" ] \
   || [ "$DO_PATH" = "provisionable-after-factory-reset" ]; then
  echo "    ✗ REBOOT      NOT AVAILABLE. Remote reboot is device-owner-only and"
  echo "                  there is no fallback. A hung unit needs a human with"
  echo "                  a power cord."
else
  echo "    ✓ REBOOT      available once device owner is set below."
fi
echo ""

# ── the one-way-door explanation, stated where it matters ───────────
case "$DO_PATH" in
  held)
    ok "Device owner is ALREADY ours. This run is a no-op for device policy." ;;
  provisionable-now)
    warn "Device owner is available RIGHT NOW — and only right now."
    echo "      The moment any account is added to this box, taking device owner"
    echo "      costs a FACTORY RESET, which WIPES THE VENDOR CMS CONFIGURATION"
    echo "      (network profile, panel timers, input mapping). Do it on this trip." ;;
  blocked-other-owner)
    bad "Device owner is held by '${DO_PKG}' — the vendor's own management app."
    echo "      We CANNOT take it without a factory reset, and a factory reset"
    echo "      WIPES THE VENDOR CMS CONFIGURATION. Do not do that on a whim."
    echo "      Continuing in LIMITED MODE: install + volume + brightness + blank."
    echo "      Remote reboot stays off the table on this unit."
    NO_DEVICE_OWNER=1 ;;
  provisionable-after-factory-reset)
    bad "Accounts/users already on this box block device-owner provisioning."
    echo "      accounts=$ACCOUNTS users=$USERS"
    echo "      Taking device owner requires a FACTORY RESET, which WIPES THE"
    echo "      VENDOR CMS CONFIGURATION. This script will NOT do that."
    echo "      Continuing in LIMITED MODE (no remote reboot). If you decide the"
    echo "      reset is worth it: write the vendor config down, reset by hand,"
    echo "      then re-run this script BEFORE adding any account."
    NO_DEVICE_OWNER=1 ;;
esac

if [ "$REQUIRE_DEVICE_OWNER" = 1 ] && [ "$NO_DEVICE_OWNER" = 1 ] && [ "$DO_IS_OURS" != "yes" ]; then
  die "--require-device-owner was passed but device owner is unobtainable here ($DO_PATH)"
fi

# ── locate the APKs (download only if we're actually going to run) ──
DOWNLOAD_NEEDED=0
if [ -z "$PLAYER_APK" ] || [ -z "$MANAGER_APK" ]; then DOWNLOAD_NEEDED=1; fi

# ── the plan ────────────────────────────────────────────────────────
echo ""
rule
echo "  PLAN — steps marked [WRITES] change the device"
rule
STEP=0
plan() { STEP=$((STEP+1)); printf '   %d. %s\n' "$STEP" "$*"; }
[ "$DOWNLOAD_NEEDED" = 1 ] && plan "download the latest Player + Manager release APKs (host only)"
plan "[WRITES] adb install -r  Manager   (keeps data; never uninstalls)"
plan "[WRITES] adb install -r  Player    (keeps data; never uninstalls)"
if [ "$NO_DEVICE_OWNER" = 1 ]; then
  plan "SKIP device owner — $( [ "$DO_IS_OURS" = yes ] && echo 'already ours' || echo "unavailable ($DO_PATH)" )"
else
  plan "[WRITES] dpm set-device-owner  ← ONE-WAY DOOR. Undoing it needs a FACTORY RESET."
fi
plan "[WRITES] appops set <player> WRITE_SETTINGS allow   (brightness needs it)"
[ "$SKIP_PROBE" = 0 ] && plan "re-run the read-only capability probe and print the verdict"
rule
echo ""

if [ "$DRY_RUN" = 1 ]; then
  say "--dry-run: nothing was changed."
  exit 0
fi

# ── confirmation gate ───────────────────────────────────────────────
if [ "$NO_DEVICE_OWNER" = 1 ]; then CONFIRM_WORD="PROVISION"; else CONFIRM_WORD="DEVICE-OWNER"; fi
if [ "$ASSUME_YES" = 1 ]; then
  warn "--yes given: skipping the typed confirmation."
elif [ ! -t 0 ]; then
  die "not a terminal and --yes was not passed — refusing to run destructive steps" 3
else
  printf '\033[1;33m  Type %s to continue (anything else aborts): \033[0m' "$CONFIRM_WORD"
  read -r ANSWER
  [ "$ANSWER" = "$CONFIRM_WORD" ] || die "aborted — nothing was changed" 3
fi
echo ""

# ════════════════════════════════════════════════════════════════════
#  STAGE 2 — EXECUTE
# ════════════════════════════════════════════════════════════════════

# ── fetch APKs if needed ────────────────────────────────────────────
if [ "$DOWNLOAD_NEEDED" = 1 ]; then
  command -v gh >/dev/null 2>&1 || die "gh CLI not found — pass --player/--manager APK paths" 2
  say "Downloading latest Player + Manager release APKs from ${REPO}…"
  RELEASES="$(gh release list --repo "$REPO" --limit 30)" || die "gh release list failed"
  PTAG="$(printf '%s\n' "$RELEASES" | awk '$0 ~ /player-v/ {print $1; exit}')"
  MTAG="$(printf '%s\n' "$RELEASES" | awk '$0 ~ /manager-v/ {print $1; exit}')"
  [ -n "$PTAG" ] && [ -n "$MTAG" ] || die "could not find player-v* / manager-v* releases"
  gh release download "$PTAG" --repo "$REPO" --pattern '*.apk' --dir "$TMP" || die "download of $PTAG failed"
  gh release download "$MTAG" --repo "$REPO" --pattern '*.apk' --dir "$TMP" || die "download of $MTAG failed"
  [ -n "$PLAYER_APK" ]  || PLAYER_APK="$(find "$TMP" -name 'edu-cms-player-*.apk' | head -1)"
  [ -n "$MANAGER_APK" ] || MANAGER_APK="$(find "$TMP" -name 'edu-cms-manager-*.apk' | head -1)"
  ok "Player  $PTAG"
  ok "Manager $MTAG"
fi
[ -f "$PLAYER_APK" ]  || die "Player APK not found: ${PLAYER_APK:-<unset>}"
[ -f "$MANAGER_APK" ] || die "Manager APK not found: ${MANAGER_APK:-<unset>}"

install_apk() { # install_apk <label> <path>
  local label="$1" path="$2" out
  say "Installing ${label}…"
  out="$("${ADB[@]}" install -r -g "$path" 2>&1)"
  if printf '%s' "$out" | grep -qi 'Success'; then
    ok "$label installed"
    return 0
  fi
  bad "$label install FAILED"
  printf '%s\n' "$out" | sed 's/^/      /'
  if printf '%s' "$out" | grep -q 'INSTALL_FAILED_UPDATE_INCOMPATIBLE\|signatures do not match'; then
    echo ""
    echo "      This is a SIGNING MISMATCH: a differently-signed build of this"
    echo "      package is already on the box (usually a debug build, or the"
    echo "      pre-2026-08 keystore). Fixing it requires UNINSTALLING, which"
    echo "      LOSES THE SCREEN'S PAIRING and — if Manager is device owner —"
    echo "      is refused outright. This script will not do that for you."
    echo "      Decide on site. See docs/FIELD-PROVISIONING.md § signing mismatch."
  fi
  return 1
}

install_apk "Manager" "$MANAGER_APK" || die "stopping — Manager must install before anything else"
install_apk "Player"  "$PLAYER_APK"  || die "stopping — Player failed to install"

# resolve the package ids actually on the box (release vs .debug)
PKG_LIST="$(sh_ pm list packages | sed 's/^package://')"
MGR_PKG="$(printf '%s\n' "$PKG_LIST" | grep -E "^$MGR_PKG_BASE(\.debug)?$" | head -1)"
PLR_PKG="$(printf '%s\n' "$PKG_LIST" | grep -E "^$PLR_PKG_BASE(\.debug)?$" | head -1)"
[ -n "$MGR_PKG" ] || die "Manager package not found after install"
[ -n "$PLR_PKG" ] || die "Player package not found after install"
ok "packages: manager=$MGR_PKG player=$PLR_PKG"

# ── device owner ────────────────────────────────────────────────────
if [ "$NO_DEVICE_OWNER" = 1 ]; then
  if [ "$DO_IS_OURS" = "yes" ]; then
    ok "Device owner already held by $DO_PKG — skipped (idempotent)."
  else
    warn "Device owner NOT set on this unit ($DO_PATH). Remote reboot unavailable."
  fi
else
  say "Setting Manager as device owner (one-way door)…"
  ADMIN="$MGR_PKG/com.educms.manager.AdminReceiver"
  DPM_OUT="$(sh_ dpm set-device-owner "$ADMIN")"
  if printf '%s' "$DPM_OUT" | grep -qi 'Success'; then
    ok "Device owner set — $ADMIN"
  else
    bad "dpm set-device-owner failed"
    printf '%s\n' "$DPM_OUT" | sed 's/^/      /'
    echo "      The box must have NO accounts and NO extra users. If something"
    echo "      was added since the preflight ran, re-run this script."
    echo "      Do NOT factory reset without writing the vendor CMS config down."
    [ "$REQUIRE_DEVICE_OWNER" = 1 ] && die "--require-device-owner: stopping"
    warn "continuing in limited mode (no remote reboot)"
  fi
fi

# ── WRITE_SETTINGS appop — the brightness provider needs it ─────────
say "Granting WRITE_SETTINGS appop to ${PLR_PKG}…"
if sh_ dumpsys package "$PLR_PKG" | grep -q 'android.permission.WRITE_SETTINGS'; then
  ok "Player manifest declares WRITE_SETTINGS"
else
  warn "Player manifest does NOT declare android.permission.WRITE_SETTINGS —"
  echo "      the appop below will be set but the Settings.System brightness"
  echo "      path cannot work until the manifest declares it. The player will"
  echo "      fall back to software dim, which is safe but is not real"
  echo "      backlight control."
fi
APPOP_OUT="$(sh_ appops set "$PLR_PKG" WRITE_SETTINGS allow)"
APPOP_NOW="$(sh_ appops get "$PLR_PKG" WRITE_SETTINGS)"
case "$APPOP_NOW" in
  *allow*) ok "WRITE_SETTINGS = allow" ;;
  *)       warn "WRITE_SETTINGS is '$APPOP_NOW' (set said: ${APPOP_OUT:-<no output>})"
           echo "      Some vendor images block appops over adb. Brightness will"
           echo "      degrade to software dim — the dashboard will say so." ;;
esac

# ── post-run probe ──────────────────────────────────────────────────
echo ""
if [ "$SKIP_PROBE" = 0 ]; then
  say "Re-running the read-only capability probe…"
  echo ""
  bash "$PROBE" --serial "$SERIAL" || warn "probe failed — run it by hand"
else
  warn "--skip-probe: capability verdict not re-checked"
fi

echo ""
rule
echo " Kiosk provisioned — $MANUFACTURER $MODEL ($SERIAL)"
echo ""
echo " Re-running this script is safe. It installs over the top, never"
echo " uninstalls, never factory-resets, and skips device-owner setup"
echo " when it is already held."
echo ""
echo " Next: pair the screen from the dashboard, then confirm the display"
echo " controls in Screens → this screen → Display. The controls you see"
echo " there are the ones this unit actually reported — anything the"
echo " hardware cannot do is not rendered."
echo ""
echo " Runbook: docs/FIELD-PROVISIONING.md"
rule
exit 0
