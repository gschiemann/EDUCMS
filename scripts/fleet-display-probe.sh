#!/usr/bin/env bash
#
# fleet-display-probe.sh — run the display-control capability probe across
# EVERY connected device and print ONE comparison table.
#
# WHY
# ---
# Three "identical" Goodview units off the same pallet are routinely NOT
# identical: different firmware date, one already carrying the vendor CMS
# as device owner, one with a world-writable backlight node and two
# without. Probing them one at a time and eyeballing three walls of text
# is how a field tech misses that. This prints one table, one row per
# capability, one column per unit, and flags every row where the units
# DISAGREE.
#
# It is STRICTLY READ-ONLY — it only shells out to
# scripts/display-capability-probe.sh, which writes nothing to any device.
# (NOT scripts/vendor-display-probe.sh: that is the separate deep-recon
# tool with a different CLI and no --kv contract. Both are kept.)
#
# USAGE
# -----
#   scripts/fleet-display-probe.sh                     # all connected devices
#   scripts/fleet-display-probe.sh SERIAL1 SERIAL2     # only these
#   scripts/fleet-display-probe.sh --out fleet.md      # also write markdown
#   scripts/fleet-display-probe.sh --keep-raw DIR      # keep per-device JSON
#
# EXIT CODES
#   0  every device probed
#   2  usage error / adb missing / no devices
#   3  at least one device failed to probe (table still printed)
#
# See docs/FIELD-PROVISIONING.md.
#
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PROBE="$HERE/display-capability-probe.sh"

OUT_MD=""
RAW_DIR=""
SERIALS_ARG=""

usage() { sed -n '2,34p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [ $# -gt 0 ]; do
  case "$1" in
    --out)      OUT_MD="${2:-}"; shift 2 || usage 2 ;;
    --keep-raw) RAW_DIR="${2:-}"; shift 2 || usage 2 ;;
    -h|--help)  usage 0 ;;
    -*)         printf 'unknown argument: %s\n' "$1" >&2; usage 2 ;;
    *)          SERIALS_ARG="$SERIALS_ARG $1"; shift ;;
  esac
done

command -v adb >/dev/null 2>&1 || { printf 'adb not found on PATH\n' >&2; exit 2; }
[ -x "$PROBE" ] || [ -f "$PROBE" ] || { printf 'missing %s\n' "$PROBE" >&2; exit 2; }

if [ -n "$SERIALS_ARG" ]; then
  # deliberate word-split: SERIALS_ARG is a space-separated serial list
  # shellcheck disable=SC2086
  SERIALS="$(printf '%s\n' $SERIALS_ARG)"
else
  SERIALS="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
fi
DEV_COUNT="$(printf '%s\n' "$SERIALS" | grep -c .)"
if [ "$DEV_COUNT" -lt 1 ]; then
  printf 'no devices connected (adb devices shows none in state "device")\n' >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

FAILED=0
IDX=0
COLS=""          # space-separated list of indices that probed OK
echo "Probing $DEV_COUNT device(s)…" >&2
while IFS= read -r s; do
  [ -n "$s" ] || continue
  IDX=$((IDX + 1))
  if bash "$PROBE" --serial "$s" --kv > "$TMP/$IDX.kv" 2>"$TMP/$IDX.err"; then
    COLS="$COLS $IDX"
    printf '  ok   %s\n' "$s" >&2
    if [ -n "$RAW_DIR" ]; then
      mkdir -p "$RAW_DIR"
      bash "$PROBE" --serial "$s" --json > "$RAW_DIR/$s.json" 2>/dev/null
    fi
  else
    FAILED=$((FAILED + 1))
    printf '  FAIL %s — %s\n' "$s" "$(head -1 "$TMP/$IDX.err")" >&2
    rm -f "$TMP/$IDX.kv"
  fi
  printf '%s\n' "$s" > "$TMP/$IDX.serial"
done <<EOF
$SERIALS
EOF

# deliberate word-split: COLS is a space-separated index list
# shellcheck disable=SC2086
NCOL="$(printf '%s\n' $COLS | grep -c .)"
[ "$NCOL" -ge 1 ] || { printf 'every device failed to probe\n' >&2; exit 3; }

val() { # val <colIndex> <key>
  grep "^$2=" "$TMP/$1.kv" 2>/dev/null | head -1 | cut -d= -f2-
}

# ── column widths ───────────────────────────────────────────────────
LABEL_W=22
COL_W=18
for i in $COLS; do
  hdr="$(val "$i" model)"
  [ "${#hdr}" -gt "$COL_W" ] && COL_W="${#hdr}"
done
[ "$COL_W" -gt 26 ] && COL_W=26

trunc() { # trunc <string> <width>
  if [ ${#1} -le "$2" ]; then printf '%s' "$1"
  else printf '%s…' "$(printf '%s' "$1" | cut -c1-$(( $2 - 1 )))"; fi
}

row() { # row <label> <key>   → prints the row, returns 1 when values differ
  local label="$1" key="$2" first="" differs=0 line out
  line="$(printf "%-${LABEL_W}s" "$label")"
  for i in $COLS; do
    v="$(val "$i" "$key")"
    [ -n "$v" ] || v="-"
    if [ -z "$first" ]; then first="$v"; elif [ "$v" != "$first" ]; then differs=1; fi
    line="$line  $(printf "%-${COL_W}s" "$(trunc "$v" "$COL_W")")"
  done
  out="$line"
  [ "$differs" = 1 ] && out="$line  << DIFF"
  printf '%s\n' "$out"
  return "$differs"
}

section() { printf '\n%s\n' "$1"; }

hr() {
  # NOTE: do NOT build this with `tr ' ' '─'` — tr is byte-oriented and
  # mangles the multi-byte box-drawing character into replacement noise.
  local n=$(( LABEL_W + NCOL * (COL_W + 2) + 8 ))
  awk -v n="$n" 'BEGIN{ s=""; for(i=0;i<n;i++) s=s "─"; print s }'
}

# ── table ───────────────────────────────────────────────────────────
echo ""
hr
echo "  FLEET DISPLAY-CAPABILITY COMPARISON — read-only, nothing changed"
echo "  $(date)"
hr
printf "%-${LABEL_W}s" "device"
for i in $COLS; do printf "  %-${COL_W}s" "$(trunc "$(cat "$TMP/$i.serial")" "$COL_W")"; done
echo ""
hr

section "IDENTITY"
row "  manufacturer"     manufacturer      || true
row "  model"            model             || true
row "  board"            board             || true
row "  android"          android           || true
row "  sdk"              sdk               || true
row "  build"            build             || true

section "INSTALL / POLICY"
row "  manager installed" managerInstalled  || true
row "  player installed"  playerInstalled   || true
row "  player installer"  playerInstaller   || true
row "  device owner"      deviceOwnerPkg    || true
row "  owner is ours"     deviceOwnerIsOurs || true
row "  admin active(any)" adminActive       || true
row "  admin is OURS"     adminOurs         || true
row "  accounts"          accounts          || true
row "  users"             users             || true

section "VERDICT  (this is what the dashboard will expose)"
VDIFF=0
row "  volume"           volume          || VDIFF=1
row "  brightness"       brightness      || VDIFF=1
row "  screenBlank"      screenBlank     || VDIFF=1
row "  reboot"           reboot          || VDIFF=1
row "  hardPowerOff"     hardPowerOff    || VDIFF=1
row "  deviceOwnerPath"  deviceOwnerPath || VDIFF=1

section "EVIDENCE"
row "  sysfs node"       sysfsNode           || true
row "  sysfs mode"       sysfsMode           || true
row "  sysfs world-write" sysfsWorldWritable || true
row "  WRITE_SETTINGS"   writeSettingsAppop  || true
row "  ws declared"      writeSettingsDeclared || true
row "  battery-opt exempt" batteryOptExempt  || true
row "  serial ports"     serialPorts         || true
# Field-only fact, never sent to the dashboard: would `dpm
# set-device-owner` be accepted right now? We do NOT take device owner
# (see docs/FIELD-PROVISIONING.md §7) — this row exists so a future
# manufacturer-preinstall decision has real data behind it.
row "  DO window open"   deviceOwnerWindowOpen || true

echo ""
hr
echo "  ACTION PER UNIT"
hr
for i in $COLS; do
  s="$(cat "$TMP/$i.serial")"
  dop="$(val "$i" deviceOwnerPath)"
  printf '  %s  (%s %s)\n' "$s" "$(val "$i" manufacturer)" "$(val "$i" model)"
  echo "     → Run: scripts/provision-kiosk.sh --serial $s"
  # We do NOT take device owner (docs/FIELD-PROVISIONING.md §7). None of
  # the branches below change the command above — deviceOwnerPath only
  # decides whether REBOOT exists on this unit, and today it does not.
  case "$dop" in
    held)
      echo "       ✓ device owner is already ours, so this unit ALSO has remote"
      echo "         reboot. Nothing to take, nothing to undo — leave it alone." ;;
    blocked-other-owner)
      echo "       · device owner is held by '$(val "$i" deviceOwnerPkg)' (the vendor's app)."
      echo "         Irrelevant to us: volume, brightness, blank/wake and schedules"
      echo "         need no ownership. Do NOT factory reset to chase it." ;;
    provisionable-after-factory-reset)
      if [ "$(val "$i" deviceOwnerWindowOpen)" = "yes" ]; then
        echo "       · no owner and no accounts, so this box WOULD accept device"
        echo "         owner. We deliberately do not take it (§7). No reset needed,"
        echo "         no window to miss — nothing here is time-critical."
      else
        echo "       · no owner; accounts=$(val "$i" accounts) users=$(val "$i" users) would block it anyway."
        echo "         Irrelevant to us — we are not taking device owner (§7)."
      fi ;;
    *)
      echo "       ? deviceOwnerPath=$dop — re-run the single-unit probe for detail." ;;
  esac
  if [ "$(val "$i" reboot)" != "device-owner" ]; then
    echo "       ! REBOOT is not available on this unit and no fallback exists."
    echo "         The dashboard renders no reboot control for it. The future fix"
    echo "         is a manufacturer preinstall (platform-signed system app)."
  fi
  if [ "$(val "$i" adminOurs)" != "yes" ]; then
    echo "       ! blank/wake will run on the SOFTWARE OVERLAY (always works, but"
    echo "         the backlight stays lit — no power saving). provision-kiosk.sh"
    echo "         offers to activate device ADMIN, which upgrades it to a real"
    echo "         screen-off. Reversible; no factory reset."
  fi
  if [ "$(val "$i" brightness)" = "software-dim" ]; then
    echo "       ! brightness is SOFTWARE-DIM only on this unit — the dashboard will"
    echo "         say so. No backlight control, therefore no power saving."
  fi
  if [ "$(val "$i" writeSettingsAppop)" != "allow" ] && [ "$(val "$i" playerInstalled)" = "yes" ]; then
    echo "       ! WRITE_SETTINGS appop is '$(val "$i" writeSettingsAppop)'. provision-kiosk.sh grants it;"
    echo "         with it, brightness can reach the real Settings.System path."
  fi
  if [ "$(val "$i" batteryOptExempt)" = "no" ]; then
    echo "       ! not exempt from battery optimisation — on/off schedules can fire"
    echo "         late under doze. provision-kiosk.sh whitelists it."
  fi
  if [ "$(val "$i" vendorAutoStartHint)" != "none-matched" ]; then
    echo "       ! vendor auto-start manager candidate(s): $(val "$i" vendorAutoStartHint)"
    echo "         Chinese ROMs kill apps that are not ticked in their own startup"
    echo "         manager, regardless of BootReceiver. Check it by hand (§6a)."
  fi
done
hr

if [ "$VDIFF" = 1 ]; then
  echo ""
  echo "  ⚠ THESE UNITS DO NOT MATCH. Rows marked << DIFF above differ across"
  echo "    the fleet, so the dashboard will expose DIFFERENT controls per"
  echo "    screen. That is correct behaviour, not a bug — but confirm it is"
  echo "    expected before you leave the site."
fi
if [ "$FAILED" -gt 0 ]; then
  echo ""
  echo "  ⚠ $FAILED device(s) failed to probe — see the FAIL lines above."
fi

# ── optional markdown ───────────────────────────────────────────────
if [ -n "$OUT_MD" ]; then
  # backticks below are markdown, not command substitution
  # shellcheck disable=SC2016
  {
    printf '# Fleet display-capability comparison\n\n_%s_\n\n' "$(date)"
    printf '|  |'; for i in $COLS; do printf ' %s |' "$(cat "$TMP/$i.serial")"; done; printf '\n'
    # `--` is required: a format string starting with '-' is otherwise
    # parsed as a printf option and silently emits nothing.
    printf -- '|---|'; for _ in $COLS; do printf -- '---|'; done; printf '\n'
    for k in manufacturer model board android sdk build \
             managerInstalled playerInstalled managerVersion playerVersion \
             playerInstaller deviceOwnerPkg deviceOwnerIsOurs \
             adminActive adminOurs accounts users \
             volume brightness screenBlank reboot hardPowerOff deviceOwnerPath \
             deviceOwnerWindowOpen \
             sysfsNode sysfsMode sysfsWorldWritable writeSettingsAppop \
             writeSettingsDeclared batteryOptExempt serialPorts \
             vendorAutoStartHint; do
      printf '| **%s** |' "$k"
      for i in $COLS; do printf ' `%s` |' "$(val "$i" "$k")"; done
      printf '\n'
    done
    printf '\nRunbook: `docs/FIELD-PROVISIONING.md`\n'
  } > "$OUT_MD"
  echo ""
  echo "  markdown written to $OUT_MD"
fi

[ "$FAILED" -gt 0 ] && exit 3
exit 0
