#!/usr/bin/env bash
#
# vendor-display-probe.sh — READ-ONLY recon of an Android signage box's
# display-control surface. Answers "what can we drive without a vendor SDK?"
#
# TARGETS: Goodview (first), NovaStar Taurus, TCL, any Android signage SoC.
#
# ─────────────────────────────────────────────────────────────────────────
# ⚠️  SAFETY CONTRACT — THIS SCRIPT CANNOT BRICK A UNIT.
# ─────────────────────────────────────────────────────────────────────────
# Every command below is a READ. There is no `settings put`, no `setprop`,
# no `service call`, no `am broadcast`, no `dpm`, no `pm install`, no
# `pm uninstall`, no write to /sys. Nothing is actuated. The worst case is
# a command returns "permission denied" and we log that as a finding.
#
# Two things are DELIBERATELY not done here, because they are the only
# genuinely dangerous moves on these boxes and they must be a human
# decision made with eyes on the findings:
#
#   1. `service call <vendor_service> <code> ...` — blind binder transacts
#      against a vendor system service with guessed transaction codes can
#      hard-crash system_server. On cheap OEM ROMs with no watchdog
#      recovery that is a bootloop, and a bootloop on a wall-mounted
#      display is a truck roll. We ENUMERATE services; we never transact.
#
#   2. `dpm set-device-owner` — see the DEVICE OWNER section of the report
#      this produces. Not destructive, but it is one-way without a factory
#      reset, and if the vendor CMS already holds device owner it will fail
#      anyway. `scripts/provision-kiosk.sh` is the supported path.
#
# NOT the same tool as scripts/display-capability-probe.sh. That one is the
# narrow, machine-readable capability verdict (--kv / --json) that
# provision-kiosk.sh and fleet-display-probe.sh consume. This one is the
# DEEP RECON dump you run once per new hardware model. Keep both; they do
# not share a CLI.
#
# USAGE
#   scripts/vendor-display-probe.sh                  # auto-detect device
#   scripts/vendor-display-probe.sh -s <serial>      # pick a device
#   scripts/vendor-display-probe.sh --pull-apks      # also pull vendor APKs
#                                                    # for offline manifest
#                                                    # analysis (slow, ~50MB)
#
# OUTPUT
#   scratch/vendor-probe/<model>-<timestamp>/
#     00-SUMMARY.md      ← read this first; the verdict
#     raw/*.txt          ← every raw dump, for grepping later
#     apks/*.apk         ← vendor APKs (only with --pull-apks)
#
# scratch/ is gitignored — dumps can contain device serials and network
# config, so they stay local unless you deliberately copy findings out.
#
set -uo pipefail   # NOTE: deliberately no `-e`. Half these commands fail on
                   # any given OEM ROM and that failure is itself a finding.

# ── args ─────────────────────────────────────────────────────────────────
SERIAL=""
PULL_APKS=0
while [ $# -gt 0 ]; do
  case "$1" in
    -s) SERIAL="${2:-}"; shift 2 ;;
    --pull-apks) PULL_APKS=1; shift ;;
    -h|--help) sed -n '2,51p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done

command -v adb >/dev/null || { echo "adb not found on PATH" >&2; exit 1; }

if [ -z "$SERIAL" ]; then
  COUNT="$(adb devices | grep -cE '\sdevice$')"
  if [ "$COUNT" != "1" ]; then
    echo "Found $COUNT devices. Pass -s <serial>. Devices:" >&2
    adb devices >&2
    exit 1
  fi
  SERIAL="$(adb devices | grep -E '\sdevice$' | head -1 | cut -f1)"
fi

A() { adb -s "$SERIAL" "$@"; }
SH() { adb -s "$SERIAL" shell "$@" 2>&1; }

# ── output dir ───────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL="$(SH getprop ro.product.model | tr -d '\r' | tr ' /' '__')"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$ROOT/scratch/vendor-probe/${MODEL:-unknown}-$STAMP"
RAW="$OUT/raw"
mkdir -p "$RAW"

say()  { printf '\033[1;36m==>\033[0m %s\n' "$*"; }
ok()   { printf '\033[1;32m  ✓\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m  !\033[0m %s\n' "$*"; }

say "Device $SERIAL  ($MODEL)"
say "Writing to $OUT"

# dump <name> <shell command...>  — capture a read-only shell command
dump() {
  local name="$1"; shift
  SH "$@" > "$RAW/$name.txt"
  local n; n="$(wc -l < "$RAW/$name.txt" | tr -d ' ')"
  printf '    %-28s %s lines\n' "$name" "$n"
}

# ── 1. identity ──────────────────────────────────────────────────────────
say "1/9  Device identity + build properties"
dump getprop            getprop
dump build-fingerprint  "getprop ro.build.fingerprint; getprop ro.product.manufacturer; getprop ro.product.brand; getprop ro.product.model; getprop ro.product.device; getprop ro.board.platform; getprop ro.hardware; getprop ro.build.version.release; getprop ro.build.version.sdk"

# ── 2. device owner / admin state ────────────────────────────────────────
# THE question: can our Manager APK ever become device owner on this box,
# or has the vendor CMS already claimed it? `dumpsys device_policy` prints
# "Device Owner:" when one exists. Also catches profile owners and any
# active device admins (the vendor CMS often registers as a plain admin
# without taking device owner — that case is FINE, we can still take DO).
say "2/9  Device owner / device admin state"
dump device_policy      dumpsys device_policy
dump accounts           dumpsys account
dump users              "pm list users"

# ── 3. backlight / brightness surface ────────────────────────────────────
# The single highest-value probe. Three candidate control paths, in
# descending order of "actually maps to the panel backlight":
#   a) /sys/class/backlight/*/brightness      (kernel driver, the real thing)
#   b) /sys/class/leds/lcd-backlight/brightness
#   c) Settings.System.screen_brightness      (may or may not be wired)
say "3/9  Backlight + brightness surface"
dump sys-backlight      "ls -la /sys/class/backlight/ 2>&1; echo '--- per-node ---'; for d in /sys/class/backlight/*/; do echo \"== \$d\"; ls -la \$d 2>&1; echo -n 'brightness='; cat \$d/brightness 2>&1; echo; echo -n 'max_brightness='; cat \$d/max_brightness 2>&1; echo; echo -n 'bl_power='; cat \$d/bl_power 2>&1; echo; done"
dump sys-leds           "ls -la /sys/class/leds/ 2>&1; for d in /sys/class/leds/*/; do echo \"== \$d\"; echo -n 'brightness='; cat \$d/brightness 2>&1; echo; echo -n 'max_brightness='; cat \$d/max_brightness 2>&1; echo; done"
dump sys-graphics       "ls -la /sys/class/graphics/ 2>&1; cat /sys/class/graphics/fb0/blank 2>&1"
dump display            dumpsys display
dump power              dumpsys power

# ── 4. settings namespaces (vendor keys hide here) ───────────────────────
# Chinese commercial-display vendors very often add their own rows to
# Settings.System / .Global rather than shipping an SDK. Anything matching
# backlight/bright/panel/lcd/power/hdmi/timer/schedule is a candidate.
say "4/9  Settings namespaces (system / secure / global)"
dump settings-system    "settings list system"
dump settings-secure    "settings list secure"
dump settings-global    "settings list global"

# ── 5. system services (vendor services are the SDK, unwrapped) ──────────
# `service list` names every registered binder service. A vendor service
# called e.g. gv_display / tcl_panel / novastar_led IS the SDK — the SDK jar
# is just a typed wrapper around AIDL transacts to it.
# WE ENUMERATE ONLY. See the safety contract at the top: never `service call`.
say "5/9  Registered system services"
dump service-list       "service list"
dump hdmi_control       dumpsys hdmi_control
dump audio              dumpsys audio
dump features           "pm list features"

# ── 6. vendor packages + their exported control surface ─────────────────
# `dumpsys package <pkg>` prints each receiver/service WITH its intent
# filters. That is how we discover broadcast-based control APIs
# (the "am broadcast -a com.vendor.action.SET_BACKLIGHT --ei value 50"
# pattern) without any SDK or documentation.
say "6/9  System packages + exported components"
dump packages-system    "pm list packages -s"
dump packages-all       "pm list packages -f"

VENDOR_PKGS="$(grep -oE '[a-z0-9_.]+' "$RAW/packages-system.txt" \
  | grep -iE '^(com|cn|net|org)\.(gv|goodview|good_view|novastar|nova|xixun|tcl|rockchip|amlogic|hisilicon|allwinner|mstar|realtek|sunchip|vendor|oem|android\.hardware)' \
  | sort -u)"

if [ -n "$VENDOR_PKGS" ]; then
  ok "$(echo "$VENDOR_PKGS" | wc -l | tr -d ' ') candidate vendor packages"
  echo "$VENDOR_PKGS" > "$RAW/vendor-packages.txt"
  : > "$RAW/vendor-components.txt"
  while read -r p; do
    [ -z "$p" ] && continue
    {
      echo "════════════════════════════════════════════════════════"
      echo "PACKAGE: $p"
      echo "════════════════════════════════════════════════════════"
      SH "dumpsys package $p"
    } >> "$RAW/vendor-components.txt"
  done <<< "$VENDOR_PKGS"
  printf '    %-28s %s lines\n' "vendor-components" "$(wc -l < "$RAW/vendor-components.txt" | tr -d ' ')"
else
  warn "no obvious vendor packages matched the name heuristic — check raw/packages-system.txt by hand"
  : > "$RAW/vendor-components.txt"
fi

# ── 7. USB / serial (the RS-232 fallback path) ───────────────────────────
# Commercial panels document an RS-232 command set for power/brightness/
# input/volume. If this box exposes a USB host port or an onboard USB-serial
# bridge, our existing CTS serial bridge (built for swim timing) already
# speaks to it — that is a vendor-independent control path.
say "7/9  USB / serial surface"
dump usb                "ls -la /dev/ttyUSB* /dev/ttyS* /dev/ttyACM* 2>&1; echo '--- lsusb ---'; lsusb 2>&1; echo '--- usb dumpsys ---'; dumpsys usb 2>&1"

# ── 8. our own apps' state ───────────────────────────────────────────────
say "8/9  EduCMS Player / Manager state"
dump educms             "dumpsys package com.educms.player 2>&1; echo; dumpsys package com.educms.manager 2>&1"

# ── 9. optional: pull vendor APKs for offline manifest analysis ─────────
if [ "$PULL_APKS" = "1" ] && [ -n "$VENDOR_PKGS" ]; then
  say "9/9  Pulling vendor APKs (offline manifest analysis)"
  mkdir -p "$OUT/apks"
  while read -r p; do
    [ -z "$p" ] && continue
    path="$(SH "pm path $p" | head -1 | sed 's/^package://' | tr -d '\r')"
    [ -z "$path" ] && continue
    A pull "$path" "$OUT/apks/$p.apk" >/dev/null 2>&1 && ok "pulled $p"
  done <<< "$VENDOR_PKGS"
else
  say "9/9  Skipping APK pull (pass --pull-apks to enable)"
fi

# ─────────────────────────────────────────────────────────────────────────
# ANALYSIS — turn the dumps into a verdict
# ─────────────────────────────────────────────────────────────────────────
say "Analysing…"

SUM="$OUT/00-SUMMARY.md"

# device owner
DO_LINE="$(grep -iE 'Device Owner|Device owner' "$RAW/device_policy.txt" | head -5)"
ADMIN_LINE="$(grep -iE 'Admin ComponentInfo|admin=ComponentInfo' "$RAW/device_policy.txt" | head -10)"
ACCT_COUNT="$(grep -c 'Account {' "$RAW/accounts.txt" 2>/dev/null || echo 0)"

# backlight
# NOTE: the old BL_READABLE (count of bare-numeric lines) was computed and
# never used — dead, and shellcheck SC2034 on it turned the Field Scripts
# gate red. The DENIED count below is the one the verdict actually reads.
BL_NODES="$(grep -oE '/sys/class/backlight/[a-zA-Z0-9_.-]+' "$RAW/sys-backlight.txt" | sort -u)"
BL_DENIED="$(grep -ciE 'permission denied|no such file' "$RAW/sys-backlight.txt" 2>/dev/null || echo 0)"

# settings candidates
SETTINGS_HITS="$(cat "$RAW"/settings-*.txt 2>/dev/null \
  | grep -iE 'backlight|bright|panel|lcd_|screen_off|hdmi|standby|sleep_timer|schedule|power_on|power_off|led_' \
  | sort -u)"

# vendor services
SVC_HITS="$(grep -iE '^[0-9]+\s+(gv|goodview|novastar|nova|xixun|tcl|display|panel|backlight|led|hdmi|power|screen)' "$RAW/service-list.txt" 2>/dev/null | sort -u)"

# broadcast-based control APIs found in vendor manifests
ACTION_HITS="$(grep -oE '[a-zA-Z0-9_.]+\.(action|intent\.action)\.[A-Z0-9_]+' "$RAW/vendor-components.txt" 2>/dev/null \
  | grep -iE 'bright|backlight|panel|display|screen|power|volume|mute|audio|reboot|shutdown|standby|sleep|wake|timer|schedule' \
  | sort -u)"

# serial
SERIAL_HITS="$(grep -oE '/dev/tty(USB|S|ACM)[0-9]+' "$RAW/usb.txt" 2>/dev/null | sort -u)"

verdict() { # verdict <emoji> <label> <detail>
  printf '| %s | **%s** | %s |\n' "$1" "$2" "$3" >> "$SUM"
}

{
cat <<EOF
# Vendor display-control probe — $MODEL

- **Device:** \`$SERIAL\`
- **When:** $(date '+%Y-%m-%d %H:%M:%S %Z')
- **Manufacturer / model / board:** $(SH getprop ro.product.manufacturer | tr -d '\r') / $(SH getprop ro.product.model | tr -d '\r') / $(SH getprop ro.board.platform | tr -d '\r')
- **Android:** $(SH getprop ro.build.version.release | tr -d '\r') (API $(SH getprop ro.build.version.sdk | tr -d '\r'))
- **Fingerprint:** \`$(SH getprop ro.build.fingerprint | tr -d '\r')\`

> Every command in this probe was a **read**. Nothing was written, set,
> transacted, broadcast, installed or provisioned. See the safety contract
> at the top of \`scripts/vendor-display-probe.sh\`.

## Verdict

| | Capability path | Finding |
|---|---|---|
EOF

if [ -n "$DO_LINE" ]; then
  verdict "🔴" "Device owner" "ALREADY CLAIMED — see below. We cannot take device owner without a factory reset."
else
  if [ "${ACCT_COUNT:-0}" != "0" ]; then
    verdict "🟡" "Device owner" "None set, but $ACCT_COUNT account(s) present → \`dpm set-device-owner\` will be REJECTED. Factory reset required first."
  else
    verdict "🟢" "Device owner" "None set, no accounts → \`scripts/provision-kiosk.sh\` can provision Manager as device owner. Unlocks reboot + reliable screen-off + silent OTA."
  fi
fi

if [ -n "$BL_NODES" ]; then
  if [ "${BL_DENIED:-0}" -gt 0 ]; then
    verdict "🟡" "Kernel backlight" "Node(s) exist but our shell was denied: $(echo "$BL_NODES" | tr '\n' ' '). Needs root or a system-signed helper — vendor path or RS-232 instead."
  else
    verdict "🟢" "Kernel backlight" "Readable node(s): $(echo "$BL_NODES" | tr '\n' ' '). Real panel brightness is reachable if writable by our UID."
  fi
else
  verdict "🔴" "Kernel backlight" "No /sys/class/backlight node. Brightness must come from a vendor service, Settings.System, or RS-232."
fi

if [ -n "$SVC_HITS" ]; then
  verdict "🟢" "Vendor system service" "$(echo "$SVC_HITS" | wc -l | tr -d ' ') candidate service(s) registered — this IS the SDK, unwrapped. See below."
else
  verdict "🟡" "Vendor system service" "No obviously-named vendor display service. Check raw/service-list.txt by hand."
fi

if [ -n "$ACTION_HITS" ]; then
  verdict "🟢" "Broadcast control API" "$(echo "$ACTION_HITS" | wc -l | tr -d ' ') candidate intent action(s) found in vendor manifests — the cheapest integration path. See below."
else
  verdict "🟡" "Broadcast control API" "No display-ish intent actions found in vendor packages. Try --pull-apks and decompile."
fi

if [ -n "$SERIAL_HITS" ]; then
  verdict "🟢" "RS-232 / serial" "Serial node(s) present: $(echo "$SERIAL_HITS" | tr '\n' ' '). Our existing CTS serial bridge can drive the panel's documented RS-232 command set — fully vendor-independent."
else
  verdict "🟡" "RS-232 / serial" "No serial node visible right now. A USB-serial dongle would still enumerate on plug-in."
fi

cat <<'EOF'

---

## Device owner / admin detail

EOF
if [ -n "$DO_LINE" ]; then
  echo '```'; echo "$DO_LINE"; echo '```'
  cat <<'EOF'
**What this means.** Android allows exactly ONE device owner per device. If
the vendor's own CMS holds it, our Manager APK cannot be provisioned as
device owner without a factory reset — and a factory reset wipes the
vendor CMS configuration too. Do NOT reset a production unit to chase this.

Fallback if device owner is unavailable: `lockNow()` still works with a
plain **device admin** registration (we already declare `force-lock` in
`manager/src/main/res/xml/device_admin.xml`), which gets us screen-off.
`reboot()` is device-owner-only and would be lost.
EOF
else
  echo "_No device owner set on this unit._"
fi
if [ -n "$ADMIN_LINE" ]; then
  echo; echo "Active device admins:"; echo '```'; echo "$ADMIN_LINE"; echo '```'
fi

cat <<'EOF'

## Candidate vendor system services

These are registered binder services whose names suggest display/power
control. A vendor "SDK jar" is normally nothing but a typed wrapper around
AIDL transacts to one of these.

⚠️ Do NOT run `service call <name> <code>` to explore these. Guessed
transaction codes against system_server can hard-crash it, and on an OEM
ROM with no watchdog recovery that is a bootloop on a wall-mounted screen.
The safe way to learn the interface is to pull the vendor APK/framework jar
(`--pull-apks`) and read the AIDL stub offline.

EOF
if [ -n "$SVC_HITS" ]; then echo '```'; echo "$SVC_HITS"; echo '```'; else echo "_None matched the name heuristic._"; fi

cat <<'EOF'

## Candidate broadcast control APIs

Intent actions declared by vendor packages that look display/power related.
Many Chinese commercial-display vendors ship control as a broadcast
receiver instead of an SDK, e.g.:

    am broadcast -a com.vendor.action.SET_BACKLIGHT --ei value 50

If one of these turns out to be the real control surface, integrating is a
~20-line `sendBroadcast()` in the Player — no SDK, no NDA, no vendor jar.

**Before firing any of these on a production unit**, test on the bench unit
and confirm the receiver is exported and unprotected (`dumpsys package`
output in `raw/vendor-components.txt` shows `exported=true` and any
`permission=`).

EOF
if [ -n "$ACTION_HITS" ]; then echo '```'; echo "$ACTION_HITS"; echo '```'; else echo "_None found._"; fi

cat <<'EOF'

## Candidate Settings keys

Vendor-added rows in Settings.System / .Secure / .Global. These are
writable with the `WRITE_SETTINGS` appop (grantable one-shot over adb:
`adb shell appops set com.educms.player WRITE_SETTINGS allow`) and are
often how a vendor exposes brightness/standby/schedule without an SDK.

EOF
if [ -n "$SETTINGS_HITS" ]; then echo '```'; echo "$SETTINGS_HITS"; echo '```'; else echo "_No matching keys._"; fi

cat <<EOF

## Raw dumps

All under \`raw/\`. Useful greps:

\`\`\`bash
cd "$OUT"
grep -i backlight raw/*.txt
grep -iE 'exported=true' raw/vendor-components.txt | head -50
grep -iE 'action:' raw/vendor-components.txt | sort -u
\`\`\`

## Next step

Paste \`00-SUMMARY.md\` back into the VenueOS session. The verdict table
decides which provider we implement first in the Player's DisplayControl
stack (vendor broadcast → vendor service → device-owner DPM → RS-232 →
software dim).
EOF
} > "$SUM"

echo
ok "Summary  → $SUM"
ok "Raw      → $RAW"
echo
say "Verdict:"
sed -n '/^## Verdict/,/^---/p' "$SUM" | sed 's/^/    /'
echo
say "Paste 00-SUMMARY.md back into the session to pick the integration path."
