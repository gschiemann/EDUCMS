#!/usr/bin/env bash
# provision-panel.sh — ZERO-PROMPT panel setup for professional installs.
#
# Operator, 2026-08-25, after walking the six on-panel grant dialogs on a
# real L55 during the v1.1.4 upgrade: "why cant we pop one menu where we
# quickly check everything we want and then it auto configures everything...
# its a lot for an end user."
#
# Android will not let ANY app grant these from one dialog without
# device-owner provisioning (factory reset). But over adb, an INSTALLER can
# grant every one of them unattended — run this once per panel during
# physical install (USB debugging on), and the v1.1.4+ SetupCeremony finds
# everything already held and shows NOTHING. This script grants EXACTLY the
# ceremony's six steps (SetupCeremony.kt, v1.1.4) — nothing more:
#
#   1. Allow updates              → REQUEST_INSTALL_PACKAGES (player)
#   2. Allow background updates   → REQUEST_INSTALL_PACKAGES (manager)
#   3. Brightness control         → WRITE_SETTINGS (player)
#   4. Keep Venue OS running      → battery-optimization exemption
#   5. Allow turning screen off   → device admin (PlayerAdminReceiver)
#   6. Come back after updates    → Player as HOME app (KioskHomeAlias)
#
# Usage:
#   ./scripts/provision-panel.sh              # single connected device
#   ./scripts/provision-panel.sh <serial>     # specific device (adb devices)
#
# Safe to re-run (every command is idempotent). Each step reports OK/FAIL
# and the script ends with a verification readout — trust the readout, not
# the intent.
set -u

PLAYER="com.educms.player"
MANAGER="com.educms.manager"
ADMIN_COMPONENT="com.educms.player/.display.PlayerAdminReceiver"
HOME_COMPONENT="com.educms.player/.KioskHomeAlias"

SERIAL="${1:-}"
ADB=(adb)
[ -n "$SERIAL" ] && ADB=(adb -s "$SERIAL")

if ! "${ADB[@]}" get-state >/dev/null 2>&1; then
  echo "✗ No device reachable over adb$( [ -n "$SERIAL" ] && echo " (serial $SERIAL)" )."
  echo "  Enable USB debugging on the panel (Settings → About → tap Build 7× → Developer options),"
  echo "  connect USB, accept the RSA prompt, then re-run."
  exit 1
fi

step() { printf '%-52s' "$1"; }
run()  { if "${ADB[@]}" shell "$@" >/dev/null 2>&1; then echo "OK"; else echo "FAIL (see note below)"; FAILED=1; fi; }
FAILED=0

echo "── Provisioning $("${ADB[@]}" shell getprop ro.product.model | tr -d '\r') ─────────────"

step "1/6 Install-packages (player)";  run appops set "$PLAYER" REQUEST_INSTALL_PACKAGES allow
step "2/6 Install-packages (manager)"; run appops set "$MANAGER" REQUEST_INSTALL_PACKAGES allow
step "3/6 Write-settings (brightness)"; run appops set "$PLAYER" WRITE_SETTINGS allow
step "4/6 Battery-optimization exempt"; run dumpsys deviceidle whitelist "+$PLAYER"
step "5/6 Device admin (screen off)";   run dpm set-active-admin "$ADMIN_COMPONENT"
# HOME needs the alias enabled first (it ships disabled so non-kiosk installs
# never hijack the launcher — see the manifest comment), then set as default.
# ⚠ FOREIGN-OWNER BOXES (Goodview/OEM-CMS class, 2026-08-25 G43 lesson): when
# ANOTHER app is device/profile owner, claiming HOME starts the launcher war
# the manifest comment warns about — and after a reboot the OEM launcher wins
# anyway. On those boxes SKIP home entirely and configure the OEM launcher's
# own auto-start/boot-app setting to launch VenueOS Player instead.
if "${ADB[@]}" shell dpm list-owners 2>/dev/null | tr -d '\r' | grep -vq "com.educms" && \
   "${ADB[@]}" shell dpm list-owners 2>/dev/null | tr -d '\r' | grep -q "admin\|owner"; then
  step "6/6 Home app";                  echo "SKIPPED — another app owns this device; set VenueOS as the boot app in the OEM launcher's settings instead"
else
  step "6/6 Home app — enable alias";   run pm enable "$HOME_COMPONENT"
  step "    Home app — set default";    run cmd package set-home-activity "$HOME_COMPONENT"
fi
# Manifest-declared niceties that some Android builds gate (harmless if absent):
step "    Notifications (13+, best-effort)"; run pm grant "$PLAYER" android.permission.POST_NOTIFICATIONS

echo ""
echo "── Verification (device truth, not intent) ──────────────────────────"
echo "install-packages player : $("${ADB[@]}" shell appops get "$PLAYER" REQUEST_INSTALL_PACKAGES | tr -d '\r' | tail -1)"
echo "install-packages manager: $("${ADB[@]}" shell appops get "$MANAGER" REQUEST_INSTALL_PACKAGES | tr -d '\r' | tail -1)"
echo "write-settings          : $("${ADB[@]}" shell appops get "$PLAYER" WRITE_SETTINGS | tr -d '\r' | tail -1)"
echo "battery whitelist       : $("${ADB[@]}" shell dumpsys deviceidle whitelist | tr -d '\r' | grep -c "$PLAYER" ) entr(y/ies) for $PLAYER"
echo "device admin            : $("${ADB[@]}" shell dpm list-owners 2>/dev/null | tr -d '\r' | head -2)"
echo "                          $("${ADB[@]}" shell dumpsys device_policy | tr -d '\r' | grep -m1 "$PLAYER" || echo 'not listed — check step 5')"
echo "home app                : $("${ADB[@]}" shell cmd shortcut get-default-launcher 2>/dev/null | tr -d '\r' | head -1)"

echo ""
if [ "$FAILED" = "1" ]; then
  echo "⚠ One or more steps FAILED. Common causes:"
  echo "  • dpm refused: an OEM CMS is already a device/profile owner — use its portal, or skip step 5 (screen-off falls back to vendor recipe/manual)."
  echo "  • set-home-activity missing: older Android — pick VenueOS once in the launcher chooser instead."
  echo "  • appops refused: some OEM builds alias the op — run the ceremony for just that step; the rest stay silent."
  exit 1
fi
echo "✓ Panel provisioned. Launch VenueOS Player — the setup ceremony should show NOTHING."
