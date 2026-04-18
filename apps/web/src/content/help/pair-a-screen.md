---
title: How to pair a new screen
category: Screens
updated: 2026-04-16
excerpt: Turn any Chromebook, smart TV, or kiosk into an EduSignage display in under 2 minutes.
---

# How to pair a new screen

EduSignage doesn't require special hardware. Any device with a modern web browser can become a signage display.

## Supported devices

- Chromebooks and Chromeboxes in kiosk mode
- Fire TV sticks, Roku (with web browser), Apple TV
- Smart TVs with built-in Chromium browsers (Samsung, LG, Sony)
- Raspberry Pi 4+ running Chromium in kiosk mode
- Any Windows, macOS, or Linux computer in full-screen browser mode

## Pairing steps

1. In the dashboard, go to **Screens → Add screen**. Give it a name (e.g. "Cafeteria TV") and optionally assign it to a screen group.
2. Click **Generate pairing code**. You'll get a 6-character code like `A3F9K2` that expires in 10 minutes.
3. On the physical display, open `https://edusignage.app/player` in a browser.
4. Enter the pairing code on the player page. The display registers itself with your tenant and starts polling for assignments.
5. The screen card in your dashboard flips from **Unpaired** to **Online** within a few seconds.

## What gets sent back

When a screen comes online, it reports device metadata you can see in the dashboard:

- **Resolution** (e.g. 1920x1080)
- **OS / browser info** (helps with troubleshooting)
- **Last ping time** — the player heartbeats every 30 seconds

If `lastPingAt` is more than 2 minutes old, the screen shows as **Offline** in red.

## Rotating displays (portrait mode)

Some hallway displays are mounted in portrait orientation. In the screen's detail page, set **Orientation** to `portrait` and pick a portrait-first template (for example, "Hallway Portrait Display"). The player rotates the viewport automatically — you don't need to change anything at the OS level.

## Kiosk mode tips

For Chromebooks, we recommend setting up **Chrome OS managed kiosk mode** with the URL set to your player + pre-baked pairing. See [the kiosk hardening guide](/help/kiosk-hardening) for full instructions.

## Troubleshooting

- **Code doesn't work**: Codes expire after 10 minutes. Generate a new one.
- **Screen shows "Unpaired"**: Network/firewall may be blocking WebSocket. We fall back to HTTP polling automatically, but double-check your content filter allows `edusignage.app` and `*.edusignage.app` on ports 443 and 80.
- **Screen is blank**: No schedule applies right now. Assign a default template from the screen's detail page.
