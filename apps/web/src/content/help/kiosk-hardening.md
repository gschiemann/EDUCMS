---
title: Kiosk and touch display hardening
category: Screens
updated: 2026-10-11
excerpt: Lock down Chromeboxes, Fire TVs, and Raspberry Pi displays so the public can't escape to the browser or OS.
---

# Kiosk and touch display hardening

Public-facing signage needs to survive curious visitors. Here are the configurations we recommend for each supported device.

## Chrome OS (managed kiosk)

The cleanest option if you already manage Chromebooks through the Google Admin console.

VenueOS has no separate Chrome app to install — the player is a web page, `https://venue-os.app/player`, and Chrome OS can run a web page as a kiosk.

1. In the Google Admin console, go to **Devices → Chrome → Devices**.
2. Enroll the Chromebook or Chromebox into a dedicated **Kiosk** OU.
3. Under **Apps & extensions → Kiosks**, add a kiosk **web app by URL** and enter `https://venue-os.app/player`.
4. Set **Auto-launch kiosk app** to that web app.
5. Reboot the device. It opens straight into the VenueOS player and shows a 6-character pairing code. Pair it from **Screens → Pair Screen** in the dashboard, once.

The pairing is kept in the device's browser storage, so the screen stays paired across restarts. Don't run the player in Guest or other wipe-on-exit modes — the screen would ask to be paired again after every restart.

Disable developer mode at the hardware level with a **cr50 lock** if possible.

## Amazon Fire TV

1. Install the **Silk browser** or Firefox.
2. Navigate to `https://venue-os.app/player` and pair.
3. Use an Android kiosk app (e.g. **Fully Kiosk Browser**) to lock the home button.
4. Disable the Alexa button on the remote.

## Raspberry Pi (Chromium kiosk)

1. Use **Raspberry Pi OS Lite** with Chromium installed.
2. Set Chromium to autostart in `--kiosk` mode with `--noerrdialogs --disable-infobars --app=https://venue-os.app/player`. On first start the screen shows a pairing code — pair it from the dashboard once. Don't add `--incognito`: it wipes the pairing on every reboot.
3. Use `xset s off; xset -dpms; xset s noblank` to disable screen blanking.
4. Put the Pi behind a locked enclosure — curious hands will unplug things.

## Touch displays

VenueOS player respects touch input when the current template has tappable widgets (wayfinding, menus, directories). To allow or restrict touch:

- Set the **Interactive** flag per template in the builder
- Non-interactive templates ignore touch to prevent accidental navigation

For ADA: don't mount touch displays higher than 48" from the floor (reachable from wheelchair).

## Network and content filtering

Allowlist in your network's content filter. Three of these are separate hosts — get all three, or you will hit failures that look like a broken screen rather than a blocked request:

- **The dashboard and player** — `venue-os.app` and `*.venue-os.app`, port 443
- **The VenueOS API, including its WebSocket** — this is a *different* host from the dashboard. Its address is the API URL configured for your deployment — a Super Admin can read the exact value under **Settings → Developer & audit**, in the **System & build** section, shown as **API Endpoint**. Allow both `https://` and `wss://` on that host. A filter that permits the dashboard but blocks this host is the classic "screen sits on Connecting…" cause, and it also blocks the realtime emergency channel — alerts then arrive only on the slower HTTP polling path.
- **Uploaded assets** — served from your VenueOS storage host, not from a `venue-os.app` CDN. Copy the hostname out of any asset's URL in the Assets library; on standard deployments it is a `*.supabase.co` address. Miss this one and templates render with every image and video missing.
- **Any third-party widget sources you enable** (RSS feeds, weather APIs)

## Preventing easy takedowns

- **Physical**: mount displays 8+ feet up in public areas. Use VESA-compatible locking mounts.
- **Power**: PoE-powered devices can be remotely rebooted via your switch.
- **Remote control**: the dashboard's **Screens → Actions → Restart** pushes a reload signal to the screen over WebSocket. Faster than walking to each one.
