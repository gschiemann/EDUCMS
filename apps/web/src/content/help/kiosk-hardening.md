---
title: Kiosk and touch display hardening
category: Screens
updated: 2026-04-16
excerpt: Lock down Chromeboxes, Fire TVs, and Raspberry Pi displays so students can't escape to the browser or OS.
---

# Kiosk and touch display hardening

Public-facing signage needs to survive curious students. Here are the configurations we recommend for each supported device.

## Chrome OS (managed kiosk)

The cleanest option if you already use Google Workspace for Education.

1. In the Google Admin console, go to **Devices → Chrome → Devices**.
2. Enroll the Chromebook or Chromebox into a dedicated **Kiosk** OU.
3. Under **Apps & extensions → Kiosks**, add the EduSignage player as a kiosk app (Chrome app ID provided in your district settings).
4. Set **Auto-launch kiosk app** to the EduSignage player.
5. Reboot the device — it now boots directly into EduSignage, with no way to exit to the OS without the device password.

Disable developer mode at the hardware level with a **cr50 lock** if possible.

## Amazon Fire TV

1. Install the **Silk browser** or Firefox.
2. Navigate to `https://edusignage.app/player` and pair.
3. Use an Android kiosk app (e.g. **Fully Kiosk Browser**) to lock the home button.
4. Disable the Alexa button on the remote.

## Raspberry Pi (Chromium kiosk)

1. Use **Raspberry Pi OS Lite** with Chromium installed.
2. Set Chromium to autostart in `--kiosk` mode with `--noerrdialogs --disable-infobars --incognito --app=https://edusignage.app/player?code=YOUR_CODE`.
3. Use `xset s off; xset -dpms; xset s noblank` to disable screen blanking.
4. Put the Pi behind a locked enclosure — students will unplug things.

## Touch displays

EduSignage player respects touch input when the current template has tappable widgets (wayfinding, menus, student portals). To allow or restrict touch:

- Set the **Interactive** flag per template in the builder
- Non-interactive templates ignore touch to prevent accidental navigation

For ADA: don't mount touch displays higher than 48" from the floor (reachable from wheelchair).

## Network and content filtering

Whitelist in your district's content filter:

- `edusignage.app` and `*.edusignage.app` (ports 443 and 80)
- `wss://edusignage.app` and `ws://edusignage.app` for WebSocket
- Your CDN for uploaded assets (`cdn.edusignage.app`)
- Any third-party widget sources you enable (RSS feeds, weather APIs)

## Preventing easy takedowns

- **Physical**: mount displays 8+ feet up in hallways. Use VESA-compatible locking mounts.
- **Power**: PoE-powered devices can be remotely rebooted via your switch.
- **Remote control**: the dashboard's **Screens → Actions → Restart** pushes a reload signal to the screen over WebSocket. Faster than walking to each one.
