#!/usr/bin/env bash
#
# provision-kiosk.sh — one-command EduCMS kiosk provisioning.
# Read-only preflight, an explicit plan, a typed confirmation, then the
# writes. Ends with a capability verdict.
#
# ════════════════════════════════════════════════════════════════════
#  WE DO NOT TAKE DEVICE OWNER.  (Product decision, 2026-08-13.)
# ════════════════════════════════════════════════════════════════════
# Device owner is a one-way door: undoing it needs a FACTORY RESET,
# which on a Goodview panel also WIPES THE VENDOR CMS CONFIGURATION
# (network profile, panel timers, input mapping). We are not spending
# that on this generation of the product.
#
# The plan instead is a MANUFACTURER PREINSTALL — the app shipped in the
# system image, platform-signed. That is strictly MORE capable than
# device owner (it gets signature-level permissions device owner never
# has) and it costs the field tech nothing. Until then we take every
# tier that is reachable WITHOUT ownership:
#
#   VOLUME       AudioManager. No privilege needed at all.
#   BRIGHTNESS   real backlight where the sysfs node is world-writable,
#                otherwise Settings.System via the WRITE_SETTINGS appop
#                (grantable over adb — this script does it), otherwise
#                software dim.
#   BLANK/WAKE   ALWAYS available. Device admin `lockNow()` gives a real
#                screen-off and needs only USES_POLICY_FORCE_LOCK, which
#                any ACTIVE ADMIN holds — activated by one operator tap
#                (or one adb command), NO factory reset. Below that, the
#                software floor (black overlay + window brightness 0)
#                cannot fail.
#   SCHEDULES    on-device AlarmManager. Survives a network outage.
#   AUTO-LAUNCH  BootReceiver, already working. We do NOT take over HOME.
#
#   REBOOT       genuinely unavailable. Device-owner-only, no fallback
#                exists at any privilege level short of the preinstall.
#                The dashboard renders no reboot control on these units.
#                That is honest, not a bug.
#
# `--take-device-owner` still exists for a deliberate, unit-by-unit
# decision by the lead. It is NEVER the default and it is loud.
#
# USAGE
# -----
#   scripts/provision-kiosk.sh                      # latest release APKs
#   scripts/provision-kiosk.sh player.apk manager.apk
#   scripts/provision-kiosk.sh --serial ABC123
#   scripts/provision-kiosk.sh --dry-run            # preflight + plan only
#   scripts/provision-kiosk.sh --yes                # skip the typed confirm
#   scripts/provision-kiosk.sh --take-device-owner  # OPT-IN one-way door
#
# OPTIONS
#   --serial S               target this device (else: the only one connected)
#   --player PATH            Player APK
#   --manager PATH           Manager APK
#   --dry-run                report + print the plan, change NOTHING
#   --yes, -y                skip the typed confirmation (scripted re-runs)
#   --skip-admin             don't try to activate device admin
#   --admin-component C      pkg/Class to activate as device admin
#                            (default: auto-discovered from the box)
#   --take-device-owner      OPT IN to `dpm set-device-owner`.
#                            ONE-WAY WITHOUT A FACTORY RESET. Not default.
#   --no-device-owner        accepted, now a no-op (it IS the default)
#   --skip-probe             don't run the capability probe at the end
#   --repo OWNER/NAME        GitHub repo for the release download
#
# WHAT THIS SCRIPT WILL NEVER DO
#   • factory reset a device
#   • uninstall Player or Manager (that would lose the screen's pairing)
#   • remove or replace an existing device owner
#   • take device owner unless --take-device-owner was passed explicitly
#   • reboot the unit
#   • change which app owns HOME
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
PROBE="$HERE/display-capability-probe.sh"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  ! %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m  ✗ %s\033[0m\n' "$1" >&2; exit "${2:-1}"; }
rule() { printf '──────────────────────────────────────────────────────────────────────\n'; }

usage() { sed -n '2,80p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

# ── args ────────────────────────────────────────────────────────────
SERIAL=""
PLAYER_APK=""
MANAGER_APK=""
DRY_RUN=0
ASSUME_YES=0
TAKE_DEVICE_OWNER=0
SKIP_ADMIN=0
ADMIN_COMPONENT=""
SKIP_PROBE=0
POSITIONAL=""

while [ $# -gt 0 ]; do
  case "$1" in
    --serial|-s)            SERIAL="${2:-}"; shift 2 || usage 2 ;;
    --player)               PLAYER_APK="${2:-}"; shift 2 || usage 2 ;;
    --manager)              MANAGER_APK="${2:-}"; shift 2 || usage 2 ;;
    --repo)                 REPO="${2:-}"; shift 2 || usage 2 ;;
    --admin-component)      ADMIN_COMPONENT="${2:-}"; shift 2 || usage 2 ;;
    --dry-run|--check)      DRY_RUN=1; shift ;;
    --yes|-y)               ASSUME_YES=1; shift ;;
    --take-device-owner)    TAKE_DEVICE_OWNER=1; shift ;;
    --no-device-owner)      shift ;;   # kept for muscle memory: now the default
    --skip-admin)           SKIP_ADMIN=1; shift ;;
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
DO_PATH="$(pv deviceOwnerPath)";   DO_WINDOW="$(pv deviceOwnerWindowOpen)"
ACCOUNTS="$(pv accounts)";         USERS="$(pv users)"
ADMIN_OURS="$(pv adminOurs)"
V_BRIGHT="$(pv brightness)";       V_BLANK="$(pv screenBlank)"
V_VOL="$(pv volume)"
WS_APPOP="$(pv writeSettingsAppop)"; WS_DECL="$(pv writeSettingsDeclared)"
BATT_EXEMPT="$(pv batteryOptExempt)"
AUTOSTART_HINT="$(pv vendorAutoStartHint)"

echo ""
rule
printf '  UNIT   %s %s   Android %s (SDK %s)   serial %s\n' \
  "$MANUFACTURER" "$MODEL" "$ANDROID_REL" "$SDK" "$SERIAL"
rule
printf '  device owner        : %s\n' "${DO_PKG:-<none>}"
printf '  …ours?              : %s\n' "$DO_IS_OURS"
printf '  device-owner path   : %s\n' "$DO_PATH"
printf '  our device admin    : %s\n' "$ADMIN_OURS"
printf '  accounts / users    : %s / %s\n' "$ACCOUNTS" "$USERS"
printf '  Manager installed   : %s\n' "$(pv managerInstalled)"
printf '  Player  installed   : %s\n' "$(pv playerInstalled)"
printf '  Player installer    : %s\n' "$(pv playerInstaller)"
printf '  brightness path     : %s\n' "$V_BRIGHT"
printf '  blank path          : %s\n' "$V_BLANK"
printf '  WRITE_SETTINGS      : declared=%s appop=%s\n' "$WS_DECL" "$WS_APPOP"
printf '  battery-opt exempt  : %s\n' "$BATT_EXEMPT"
rule

# ── what this unit will and will not be able to do ──────────────────
echo ""
echo "  WHAT THIS UNIT WILL BE ABLE TO DO AFTER THIS SCRIPT"
echo ""
case "$V_VOL" in
  audiomanager) echo "    ✓ VOLUME      real, via AudioManager. Needs no privilege at all." ;;
  *)            echo "    ✗ VOLUME      no audio service found on this box." ;;
esac
case "$V_BRIGHT" in
  sysfs)    echo "    ✓ BRIGHTNESS  real backlight (sysfs node is world-writable)." ;;
  settings) echo "    ✓ BRIGHTNESS  real, via Settings.System (WRITE_SETTINGS already allowed)." ;;
  *)        echo "    ~ BRIGHTNESS  software dim today. This script grants the WRITE_SETTINGS"
            echo "                  appop below; if the vendor image accepts it, brightness"
            echo "                  upgrades to the real Settings.System path. If it refuses,"
            echo "                  the image darkens but the LCD backlight stays lit — no"
            echo "                  power saving, and the dashboard says exactly that." ;;
esac
echo "    ✓ BLANK/WAKE  ALWAYS available. Software floor (black overlay + window"
echo "                  brightness 0) can never fail; device admin upgrades it to a"
if [ "$ADMIN_OURS" = "yes" ]; then
  echo "                  real screen-off — and this unit ALREADY has our admin active."
else
  echo "                  real screen-off, which this script offers to activate below."
fi
echo "    ✓ SCHEDULES   on-device on/off windows (AlarmManager). Survive a network"
echo "                  outage; that is the point of running them on the box."
echo "    ✓ AUTO-LAUNCH BootReceiver already handles this. HOME ownership is NOT"
echo "                  changed by this script."
if [ "$DO_IS_OURS" = "yes" ]; then
  echo "    ✓ REBOOT      available — this unit already holds device owner."
elif [ "$TAKE_DEVICE_OWNER" = 1 ] && [ "$DO_WINDOW" = "yes" ]; then
  echo "    ✓ REBOOT      will become available — --take-device-owner was passed."
else
  echo "    ✗ REBOOT      NOT AVAILABLE, by design. We do not take device owner (see"
  echo "                  the header of this script). No fallback exists; the"
  echo "                  dashboard renders no reboot control on this screen. The"
  echo "                  future fix is a manufacturer preinstall as a"
  echo "                  platform-signed system app, which beats device owner."
fi
echo ""

# ── device-owner state, stated where it matters ─────────────────────
# Remember what the operator ASKED for, so that when the box overrides it
# we say so out loud instead of silently dropping an explicit flag.
DO_REQUESTED="$TAKE_DEVICE_OWNER"
NEED_DEVICE_OWNER_STEP=0
case "$DO_PATH" in
  held)
    ok "Device owner is ALREADY ours. This run is a no-op for device policy."
    # THE IDEMPOTENCY FIX. The old script printed this line and then ran
    # `dpm set-device-owner` anyway, which Android rejects with
    # IllegalStateException — and the script then printed a red ✗ plus
    # factory-reset guidance in front of a tech standing at a
    # CORRECTLY-PROVISIONED screen. Never plan the step when it is held.
    TAKE_DEVICE_OWNER=0 ;;
  blocked-other-owner)
    warn "Device owner is held by '${DO_PKG}' — the vendor's own management app."
    echo "      We are not taking it (that would need a factory reset, which wipes"
    echo "      the vendor CMS configuration). Nothing below is affected: volume,"
    echo "      brightness, blank/wake and schedules do not need ownership."
    TAKE_DEVICE_OWNER=0 ;;
  provisionable-after-factory-reset)
    if [ "$DO_WINDOW" = "yes" ]; then
      echo "      (No owner, no accounts — this box WOULD accept device owner right"
      echo "      now. We are deliberately not taking it.)"
    else
      echo "      (No owner, but accounts=$ACCOUNTS users=$USERS would block it anyway.)"
    fi ;;
esac

if [ "$DO_REQUESTED" = 1 ] && [ "$TAKE_DEVICE_OWNER" = 0 ]; then
  warn "--take-device-owner was passed, but this unit does not need it or"
  echo "      cannot accept it (deviceOwnerPath=${DO_PATH}). Ignoring the flag."
  echo "      Nothing irreversible will happen on this run."
fi

if [ "$TAKE_DEVICE_OWNER" = 1 ]; then
  if [ "$DO_WINDOW" != "yes" ]; then
    bad "--take-device-owner was passed, but this box will not accept it."
    echo "      owner='${DO_PKG:-<none>}' accounts=$ACCOUNTS users=$USERS"
    echo "      Android only accepts \`dpm set-device-owner\` with no other owner,"
    echo "      no accounts and a single user. Taking it here would need a FACTORY"
    echo "      RESET, which WIPES THE VENDOR CMS CONFIGURATION. This script will"
    echo "      NOT do that. Continuing WITHOUT device owner."
    TAKE_DEVICE_OWNER=0
  else
    NEED_DEVICE_OWNER_STEP=1
    bad "--take-device-owner: you have opted IN to the one-way door."
    echo "      Undoing device owner requires a FACTORY RESET, which WIPES THE"
    echo "      VENDOR CMS CONFIGURATION (network profile, panel timers, input"
    echo "      mapping). The default product path does NOT do this. Only continue"
    echo "      if the lead decided it for this specific unit."
  fi
fi

# ── which admin component can we activate? ──────────────────────────
# Discovered from the box, never guessed: grep the installed packages'
# dumpsys output for a receiver class whose name contains "Admin".
discover_admin_component() {
  local p out
  for p in "$MGR_PKG_BASE" "$MGR_PKG_BASE.debug" "$PLR_PKG_BASE" "$PLR_PKG_BASE.debug"; do
    out="$(sh_ "dumpsys package $p" 2>/dev/null \
      | grep -oE "$p/[A-Za-z0-9_.\$]*Admin[A-Za-z0-9_.\$]*" | head -1)"
    if [ -n "$out" ]; then printf '%s' "$out"; return 0; fi
  done
  return 1
}

if [ "$SKIP_ADMIN" = 0 ] && [ -z "$ADMIN_COMPONENT" ]; then
  ADMIN_COMPONENT="$(discover_admin_component || true)"
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
plan "[WRITES] adb install -r -i ${MGR_PKG_BASE}  Player"
echo "           └─ -i sets Manager as INSTALLER OF RECORD, the prerequisite"
echo "              for hands-free updates. Honest caveat: that only becomes"
echo "              SILENT on Android 12+ (UPDATE_PACKAGES_WITHOUT_USER_ACTION)"
echo "              or on a preinstalled system build. On Android 11 the"
echo "              install prompt still appears. Costs nothing to set now."
plan "[WRITES] appops set <player> WRITE_SETTINGS allow   (real brightness)"
plan "[WRITES] deviceidle whitelist +<player>   (schedules must survive doze)"
if [ "$SKIP_ADMIN" = 1 ]; then
  plan "SKIP device admin (--skip-admin)"
elif [ "$ADMIN_OURS" = "yes" ]; then
  plan "SKIP device admin — already active for our package (idempotent)"
elif [ -n "$ADMIN_COMPONENT" ]; then
  plan "[WRITES] activate DEVICE ADMIN ${ADMIN_COMPONENT}"
  echo "           └─ REVERSIBLE. Not device owner, no factory reset, no accounts"
  echo "              constraint. Buys a real screen-off (lockNow). One adb"
  echo "              command, or one operator tap if the image refuses adb."
else
  plan "SKIP device admin — no admin receiver found on this box"
fi
if [ "$NEED_DEVICE_OWNER_STEP" = 1 ]; then
  plan "[WRITES] dpm set-device-owner  ← ONE-WAY DOOR (you passed --take-device-owner)"
else
  plan "SKIP device owner — not taken by design (see this script's header)"
fi
[ "$SKIP_PROBE" = 0 ] && plan "re-run the read-only capability probe and print the verdict"
rule
echo ""

if [ "$DRY_RUN" = 1 ]; then
  say "--dry-run: nothing was changed."
  exit 0
fi

# ── confirmation gate ───────────────────────────────────────────────
# DEVICE-OWNER is demanded ONLY when the one-way step is actually in the
# plan. On a `held` unit the plan has no such step, so the word is
# PROVISION — matching the script's stated contract and runbook §6.
if [ "$NEED_DEVICE_OWNER_STEP" = 1 ]; then CONFIRM_WORD="DEVICE-OWNER"; else CONFIRM_WORD="PROVISION"; fi
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

install_apk() { # install_apk <label> <path> [extra adb install args...]
  local label="$1" path="$2" out
  shift 2
  say "Installing ${label}…"
  out="$("${ADB[@]}" install -r -g "$@" "$path" 2>&1)"
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
    echo "      LOSES THE SCREEN'S PAIRING. This script will not do that for you."
    echo "      Decide on site. See docs/FIELD-PROVISIONING.md § signing mismatch."
  fi
  return 1
}

install_apk "Manager" "$MANAGER_APK" || die "stopping — Manager must install before anything else"

# Player is installed with Manager as installer-of-record. If the image
# rejects -i (some vendor builds do), retry without it rather than
# leaving the Player uninstalled — the OTA nicety is not worth the trip.
if ! install_apk "Player" "$PLAYER_APK" -i "$MGR_PKG_BASE"; then
  warn "retrying Player install without the installer-of-record flag…"
  install_apk "Player" "$PLAYER_APK" || die "stopping — Player failed to install"
  warn "installer-of-record NOT set; hands-free OTA stays unavailable on this unit"
fi

# resolve the package ids actually on the box (release vs .debug)
PKG_LIST="$(sh_ 'pm list packages' | sed 's/^package://')"
MGR_PKG="$(printf '%s\n' "$PKG_LIST" | grep -E "^$MGR_PKG_BASE(\.debug)?$" | head -1)"
PLR_PKG="$(printf '%s\n' "$PKG_LIST" | grep -E "^$PLR_PKG_BASE(\.debug)?$" | head -1)"
[ -n "$MGR_PKG" ] || die "Manager package not found after install"
[ -n "$PLR_PKG" ] || die "Player package not found after install"
ok "packages: manager=$MGR_PKG player=$PLR_PKG"

# ── WRITE_SETTINGS appop — the brightness provider needs it ─────────
say "Granting WRITE_SETTINGS appop to ${PLR_PKG}…"
if sh_ "dumpsys package $PLR_PKG" | grep -q 'android.permission.WRITE_SETTINGS'; then
  ok "Player manifest declares WRITE_SETTINGS"
else
  warn "Player manifest does NOT declare android.permission.WRITE_SETTINGS —"
  echo "      the appop below will be set but Settings.System.canWrite() stays"
  echo "      false forever, so brightness falls back to software dim."
fi
APPOP_OUT="$(sh_ "appops set $PLR_PKG WRITE_SETTINGS allow")"
APPOP_NOW="$(sh_ "appops get $PLR_PKG WRITE_SETTINGS")"
case "$APPOP_NOW" in
  *allow*) ok "WRITE_SETTINGS = allow" ;;
  *)       warn "WRITE_SETTINGS is '$APPOP_NOW' (set said: ${APPOP_OUT:-<no output>})"
           echo "      Some vendor images block appops over adb. Then the operator can"
           echo "      grant it by hand on the panel: Settings → Apps → EduCMS Player"
           echo "      → 'Modify system settings' → allow. (That path needs no adb and"
           echo "      no ownership.) Failing both, brightness is software dim — safe,"
           echo "      and the dashboard says so." ;;
esac

# ── battery-optimisation exemption — schedules must survive doze ────
say "Exempting ${PLR_PKG} from battery optimisation…"
sh_ "dumpsys deviceidle whitelist +$PLR_PKG" >/dev/null 2>&1
if sh_ 'dumpsys deviceidle whitelist' | grep -q "$PLR_PKG"; then
  ok "battery-optimisation exemption in place"
else
  warn "could not confirm the doze whitelist entry."
  echo "      On-device on/off schedules may fire late by minutes on this unit."
  echo "      Operator fallback, no adb needed: Settings → Apps → EduCMS Player →"
  echo "      Battery → Unrestricted."
fi

# ── device ADMIN — reversible, no factory reset, real screen-off ────
if [ "$SKIP_ADMIN" = 1 ]; then
  warn "--skip-admin: blank/wake stays on the software overlay path."
elif [ "$ADMIN_OURS" = "yes" ]; then
  ok "Device admin already active for our package — skipped (idempotent)."
elif [ -z "$ADMIN_COMPONENT" ]; then
  warn "No device-admin receiver found on this box, so there is nothing to"
  echo "      activate. Blank/wake runs on the software overlay: it always works,"
  echo "      but the backlight stays lit (no power saving). This is expected"
  echo "      until a Player-owned DeviceAdminReceiver ships."
else
  say "Activating device admin ${ADMIN_COMPONENT}…"
  echo "      Reversible. NOT device owner. No factory reset, no accounts"
  echo "      constraint. Grants USES_POLICY_FORCE_LOCK → real screen-off."
  DPM_OUT="$(sh_ "dpm set-active-admin $ADMIN_COMPONENT" 2>&1)"
  if printf '%s' "$DPM_OUT" | grep -qi 'Success'; then
    ok "device admin active — $ADMIN_COMPONENT"
  else
    warn "adb could not activate it directly:"
    printf '%s\n' "$DPM_OUT" | sed 's/^/      /'
    echo "      Falling back to the operator tap. The panel will now show"
    echo "      Android's 'Activate device admin app?' screen."
    sh_ "am start -a android.app.action.ADD_DEVICE_ADMIN -e android.app.extra.DEVICE_ADMIN $ADMIN_COMPONENT" >/dev/null 2>&1
    if [ "$ASSUME_YES" = 1 ] || [ ! -t 0 ]; then
      warn "non-interactive run: not waiting for the tap. Re-run interactively,"
      echo "      or tap Activate on the panel and re-run this script to verify."
    else
      printf '\033[1;33m  Tap ACTIVATE on the panel, then press Enter here: \033[0m'
      read -r _
      if sh_ 'dumpsys device_policy' | grep -q "$ADMIN_COMPONENT"; then
        ok "device admin active — $ADMIN_COMPONENT"
      else
        warn "still not active. Blank/wake stays on the software overlay (safe)."
      fi
    fi
  fi
fi

# ── device owner — ONLY when explicitly opted in ────────────────────
if [ "$NEED_DEVICE_OWNER_STEP" = 1 ]; then
  say "Setting Manager as device owner (one-way door — you opted in)…"
  ADMIN="$MGR_PKG/com.educms.manager.AdminReceiver"
  DPM_OUT="$(sh_ "dpm set-device-owner $ADMIN")"
  if printf '%s' "$DPM_OUT" | grep -qi 'Success'; then
    ok "Device owner set — $ADMIN"
  else
    bad "dpm set-device-owner failed"
    printf '%s\n' "$DPM_OUT" | sed 's/^/      /'
    echo "      The box must have NO accounts and NO extra users. If something"
    echo "      was added since the preflight ran, re-run this script."
    echo "      Do NOT factory reset without writing the vendor CMS config down."
    warn "continuing without device owner — everything except REBOOT still works"
  fi
elif [ "$DO_IS_OURS" = "yes" ]; then
  ok "Device owner already held by ${DO_PKG} — untouched (idempotent)."
fi

# ── post-run probe ──────────────────────────────────────────────────
echo ""
if [ "$SKIP_PROBE" = 0 ]; then
  say "Re-running the read-only capability probe…"
  bash "$PROBE" --serial "$SERIAL" || warn "probe failed — run it by hand"
else
  warn "--skip-probe: capability verdict not re-checked"
fi

echo ""
rule
echo " Kiosk provisioned — $MANUFACTURER $MODEL ($SERIAL)"
echo ""
echo " Re-running this script is safe. It installs over the top, never"
echo " uninstalls, never factory-resets, never reboots, and skips every step"
echo " that is already done — including device admin and (when it is somehow"
echo " already held) device owner."
echo ""
if [ "$AUTOSTART_HINT" != "none-matched" ] && [ -n "$AUTOSTART_HINT" ]; then
  echo " ! VENDOR AUTO-START MANAGER — do this before you leave:"
  echo "   This ROM appears to ship its own startup/auto-start manager, separate"
  echo "   from Android's settings. An app not ticked there is killed after boot"
  echo "   no matter what our BootReceiver does. Candidates seen on this box:"
  printf '     %s\n' "$AUTOSTART_HINT"
  echo "   Open the vendor settings app, find auto-start / startup management,"
  echo "   and enable EduCMS Player AND EduCMS Manager. Then power-cycle the"
  echo "   panel and confirm the player comes back on its own."
  echo "   (UNVERIFIED on these units — see docs/FIELD-PROVISIONING.md §6a.)"
  echo ""
fi
echo " Next: pair the screen from the dashboard, then confirm the display"
echo " controls in Screens → this screen → Display. The controls you see"
echo " there are the ones this unit actually reported — anything the"
echo " hardware cannot do is not rendered. There is no reboot control"
echo " unless this unit holds device owner, and by design it does not."
echo ""
echo " Runbook: docs/FIELD-PROVISIONING.md"
rule
exit 0
