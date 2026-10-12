---
title: How to pair a new screen
category: Screens
updated: 2026-10-11
excerpt: Turn an Android display, media player, Chromebook, or any browser-capable screen into a VenueOS display in a few minutes.
---

# How to pair a new screen

VenueOS doesn't require special hardware. Any device with a modern web browser can become a signage display.

## Supported devices

- Chromebooks and Chromeboxes in kiosk mode
- Fire TV sticks, Roku (with web browser), Apple TV
- Smart TVs with built-in Chromium browsers (Samsung, LG, Sony)
- Raspberry Pi 4+ running Chromium in kiosk mode
- Any Windows, macOS, or Linux computer in full-screen browser mode

## Pairing steps

The code is shown **on the screen**, and you enter it **in the dashboard**:

1. **Start the player on the display.** On an Android display or a VenueOS media player, install and open the player app (the **Screens → Connect a screen** card has a download link and QR code). On a Chromebook, PC or smart TV with a browser, open `https://venue-os.app/player`. Either way the screen shows a 6-character pairing code and a QR code.
2. **Pair it in the dashboard.** Go to **Screens** and click **Pair Screen**, then type the code from the screen — or scan the QR code on the screen with your phone and confirm there.
3. Give the screen a name (for example "Front Entrance TV") and, optionally, a screen group, then click **Pair**.
4. The display flips from the pairing code to a Connected splash, and its card in the dashboard goes **Online** within a few seconds.

## What gets sent back

When a screen comes online, it reports device metadata you can see in the dashboard:

- **Resolution** (e.g. 1920x1080)
- **OS / browser info** (helps with troubleshooting)
- **Last check-in time** — the player checks in regularly

A screen that stops checking in shows as **Offline** in the dashboard.

## Rotating displays (portrait mode)

Some displays are mounted in portrait orientation. In the screen's detail page, set **Orientation** to `portrait` and pick a portrait-first template. The player rotates the viewport automatically — you don't need to change anything at the OS level.

## Kiosk mode tips

For Chromebooks and Chromeboxes, we recommend **Chrome OS managed kiosk mode** running the player web page, `https://venue-os.app/player`, as a kiosk web app — there is no separate Chrome app to install. Pair it once from the dashboard; the pairing survives restarts. See [the kiosk hardening guide](/help/kiosk-hardening) for full instructions.

## Network requirements for IT

A screen needs to reach **three separate hosts** over port 443. Allow all three, or the screen will look broken when it is really blocked:

| What it is | Host to allow | Used for |
|---|---|---|
| **Dashboard and player** | `venue-os.app` and `*.venue-os.app` (`https://`) | Loading the player, the pairing page and the Player app download |
| **VenueOS API** | `api-production-39a1.up.railway.app` (`https://` **and** `wss://`) | Pairing, schedules, content updates, the live connection that delivers emergency alerts |
| **Uploaded media** | `*.supabase.co` (`https://`) | Every image and video in your playlists |

Notes for IT:

- The API host is a different address from the dashboard. A filter that allows the dashboard but blocks the API leaves the screen on "Connecting…". Blocking `wss://` on it only slows alerts down (the screen falls back to polling), but it should be allowed.
- Your account's exact API address is also shown to administrators under **Settings → Developer & audit → System & build → API Endpoint**.
- No inbound ports need opening; screens only make outbound connections.
- If you use content from other sources (RSS feeds, weather, web pages), allow those hosts too.
- The same list is in [the kiosk hardening guide](/help/kiosk-hardening).

## Troubleshooting

- **Code doesn't work**: Pairing codes are short-lived. Read the code that is on the screen right now (it can change if the player restarts) and enter that one.
- **Screen shows "Unpaired" or sits on "Connecting…"**: a firewall or content filter is almost always blocking one of the hosts listed under [Network requirements for IT](#network-requirements-for-it). Allowing only `venue-os.app` is not enough.
- **Screen is blank**: No schedule applies right now. Assign a default template from the screen's detail page.
