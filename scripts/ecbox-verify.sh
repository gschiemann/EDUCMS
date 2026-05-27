#!/system/bin/sh
# ecbox-verify.sh — run this on a fresh ECBox3576 the moment it arrives
#
# Purpose: probe the box's serial ports + permissions + tooling so we
# know what's there BEFORE we ship the Player APK that depends on it.
# Print a structured report the install tech can paste into a ticket
# or read out to support.
#
# How to run:
#   1. adb push scripts/ecbox-verify.sh /data/local/tmp/
#   2. adb shell sh /data/local/tmp/ecbox-verify.sh
# Or copy to a USB stick + run from a terminal app on the box.
#
# Output: ~30 lines of plain text. No external dependencies — only
# uses tools the Android 14 Goodview image ships out of the box
# (toybox, stty, ls, hexdump). Safe to run repeatedly.

echo "════════════════════════════════════════════════════════════════════"
echo "  ECBox3576 verification — VenueOS Sports / CTS bridge readiness"
echo "  $(date)"
echo "════════════════════════════════════════════════════════════════════"
echo ""

# ─── 1. Identify the box ────────────────────────────────────────────
echo "[1/6] Device identification"
echo "  Model:      $(getprop ro.product.model)"
echo "  Brand:      $(getprop ro.product.brand)"
echo "  Hardware:   $(getprop ro.boot.hardware)"
echo "  Build:      $(getprop ro.build.display.id)"
echo "  Android:    $(getprop ro.build.version.release) (SDK $(getprop ro.build.version.sdk))"
echo "  Kernel:     $(uname -r)"
echo ""

# ─── 2. Tooling ─────────────────────────────────────────────────────
echo "[2/6] Required tooling"
for cmd in stty cat ls hexdump dd su; do
  if command -v "$cmd" >/dev/null 2>&1; then
    echo "  ✓ $cmd  → $(command -v "$cmd")"
  else
    echo "  ✗ $cmd  → MISSING (impacts: serial config)"
  fi
done
echo ""

# ─── 3. Enumerate tty devices ───────────────────────────────────────
echo "[3/6] Serial tty devices (every /dev/tty* + permissions + owner)"
ls -la /dev/tty* 2>/dev/null | grep -v "tty\(0\|1\|2\|[3-9]\)$" | grep -v "^crw-rw-rw-.*tty$" | head -20
echo ""
echo "  Look for /dev/ttyS1, /dev/ttyS2, etc. — those are the Phoenix"
echo "  terminal RS232 ports we configure for CTS. Permissions need"
echo "  to be 0666 (or our app uid in the owning group) for the"
echo "  Player APK to open them. If they're 0660 root:dialout, apply"
echo "  Device Owner provisioning OR ask Goodview for an image patch."
echo ""

# ─── 4. Read access probe ───────────────────────────────────────────
echo "[4/6] Read access probe (can our user open /dev/ttyS*?)"
for tty in /dev/ttyS1 /dev/ttyS2 /dev/ttyS3 /dev/ttyS4; do
  if [ -c "$tty" ]; then
    if dd if="$tty" of=/dev/null bs=1 count=0 2>/dev/null; then
      echo "  ✓ $tty  → readable as $(id -un)"
    else
      echo "  ✗ $tty  → permission denied (need root OR Device Owner OR 0666)"
    fi
  else
    echo "  · $tty  → device node does not exist"
  fi
done
echo ""

# ─── 5. CTS byte sniff (if any) ─────────────────────────────────────
echo "[5/6] Byte-sniff each tty for 3 seconds — paste the CTS console's"
echo "    output below to identify which Phoenix terminal it's wired"
echo "    to. If the cable is plugged in + console powered + emitting,"
echo "    you should see hex bytes (address bytes with high bit set,"
echo "    e.g. 0x81 for module 0x01 GAME_CLOCK; followed by data bytes"
echo "    with high bit clear)."
echo ""
for tty in /dev/ttyS1 /dev/ttyS2 /dev/ttyS3; do
  if [ -c "$tty" ] && dd if="$tty" of=/dev/null bs=1 count=0 2>/dev/null; then
    echo "  ── $tty ─ 9600 8-E-1, 3s window"
    stty -F "$tty" 9600 cs8 parenb -parodd -cstopb raw -echo 2>/dev/null
    # dd with status=none + timeout via background kill — Android's
    # dd doesn't support 'timeout' so we wrap.
    ( dd if="$tty" bs=64 count=8 2>/dev/null | hexdump -C | head -4 ) &
    sniff_pid=$!
    sleep 3
    kill "$sniff_pid" 2>/dev/null
    wait "$sniff_pid" 2>/dev/null
    echo ""
  fi
done

# ─── 6. APK presence ────────────────────────────────────────────────
echo "[6/6] VenueOS Player APK presence"
for pkg in com.educms.player com.educms.player.debug com.educms.manager com.educms.manager.debug; do
  if pm list packages 2>/dev/null | grep -q "package:$pkg$"; then
    ver=$(dumpsys package "$pkg" 2>/dev/null | grep versionName | head -1 | sed 's/.*versionName=//')
    echo "  ✓ $pkg  → $ver"
  else
    echo "  · $pkg  → not installed"
  fi
done
echo ""

echo "════════════════════════════════════════════════════════════════════"
echo "  Done. Next steps based on the report above:"
echo ""
echo "  • If [4/6] shows '✗ permission denied' on the right ttyS:"
echo "    apply Device Owner provisioning OR ask Goodview reseller for"
echo "    an OEM image with /dev/ttyS* set to 0666 mode."
echo ""
echo "  • If [5/6] shows hex bytes on one of the ports: that's your"
echo "    CTS tty. Set the player URL with ?ctsTty=/dev/ttyS<N>."
echo ""
echo "  • If [6/6] shows Player not installed: flash via OTA from"
echo "    venue-os.app/admin/screens or sideload the latest APK."
echo "════════════════════════════════════════════════════════════════════"
