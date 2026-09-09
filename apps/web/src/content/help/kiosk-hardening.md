---
title: Kiosk and touch display hardening
category: Screens
updated: 2026-09-08
excerpt: Lock down Chromeboxes, Fire TVs, and Raspberry Pi displays so students can't escape to the browser or OS.
---

# Kiosk and touch display hardening

Public-facing signage needs to survive curious students. Here are the configurations we recommend for each supported device.

## Chrome OS (managed kiosk)

The cleanest option if you already use Google Workspace for Education.

1. In the Google Admin console, go to **Devices → Chrome → Devices**.
2. Enroll the Chromebook or Chromebox into a dedicated **Kiosk** OU.
3. Under **Apps & extensions → Kiosks**, add the VenueOS player as a kiosk app (Chrome app ID provided in your district settings).
4. Set **Auto-launch kiosk app** to the VenueOS player.
5. Reboot the device — it now boots directly into VenueOS, with no way to exit to the OS without the device password.

Disable developer mode at the hardware level with a **cr50 lock** if possible.

## Amazon Fire TV

1. Install the **Silk browser** or Firefox.
2. Navigate to `https://venue-os.app/player` and pair.
3. Use an Android kiosk app (e.g. **Fully Kiosk Browser**) to lock the home button.
4. Disable the Alexa button on the remote.

## Raspberry Pi (Chromium kiosk)

1. Use **Raspberry Pi OS Lite** with Chromium installed.
2. Set Chromium to autostart in `--kiosk` mode with `--noerrdialogs --disable-infobars --incognito --app=https://venue-os.app/player?code=YOUR_CODE`.
3. Use `xset s off; xset -dpms; xset s noblank` to disable screen blanking.
4. Put the Pi behind a locked enclosure — students will unplug things.

## Touch displays

VenueOS player respects touch input when the current template has tappable widgets (wayfinding, menus, student portals). To allow or restrict touch:

- Set the **Interactive** flag per template in the builder
- Non-interactive templates ignore touch to prevent accidental navigation

For ADA: don't mount touch displays higher than 48" from the floor (reachable from wheelchair).

## Network and content filtering

Allowlist in your district's content filter. Three of these are separate hosts — get all three, or you will hit failures that look like a broken screen rather than a blocked request:

- **The dashboard and player** — `venue-os.app` and `*.venue-os.app`, port 443
- **The VenueOS API, including its WebSocket** — this is a *different* host from the dashboard. Its address is the API URL configured for your deployment — a district or super admin can read the exact value under **Settings → Developer**, shown as **API Endpoint**. Allow both `https://` and `wss://` on that host. A filter that permits the dashboard but blocks this host is the classic "screen sits on Connecting…" cause, and it also blocks the realtime emergency channel — alerts then arrive only on the slower HTTP polling path.
- **Uploaded assets** — served from your VenueOS storage host, not from a `venue-os.app` CDN. Copy the hostname out of any asset's URL in the Assets library; on standard deployments it is a `*.supabase.co` address. Miss this one and templates render with every image and video missing.
- **Any third-party widget sources you enable** (RSS feeds, weather APIs)

## Preventing easy takedowns

- **Physical**: mount displays 8+ feet up in hallways. Use VESA-compatible locking mounts.
- **Power**: PoE-powered devices can be remotely rebooted via your switch.
- **Remote control**: the dashboard's **Screens → Actions → Restart** pushes a reload signal to the screen over WebSocket. Faster than walking to each one.
