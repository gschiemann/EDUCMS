---
title: Network and firewall requirements
category: IT & Security
updated: 2026-10-22
excerpt: What a school or business network must allow so screens and the dashboard can reach VenueOS — outbound HTTPS only, no inbound ports.
---

# Network and firewall requirements

Screens only need **internet access**. They do not need to be on your internal network, and nothing connects *into* your network.

## The short version

- **Outbound HTTPS (TCP 443)** is the only requirement. No inbound connections, port forwarding, VPN or firewall openings.
- The VenueOS player opens **no listening ports** — the screen starts every connection.
- We recommend putting screens on a **guest or IoT network segment** that is isolated from your internal systems.
- Screens need an accurate clock: allow **NTP (UDP 123)** or provide a local time source. Certificate checks and schedules depend on it.

## Destinations to allow (outbound TCP 443)

| Destination | Used for |
|---|---|
| `venue-os.app` | The dashboard and the screen player application |
| `api-production-39a1.up.railway.app` | The VenueOS service, including the real-time connection to screens (secure WebSocket, `wss://`) |
| `bhdaxzfalaycfopvcopm.supabase.co` | Your content files and player software updates |
| `github.com`, `*.githubusercontent.com` | Android player software updates (backup download route) |
| `fonts.googleapis.com`, `fonts.gstatic.com` | Web fonts used by many design templates |
| `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `ipapi.co` | Weather widgets only — the local forecast, and an approximate city when a weather widget has no location set |
| `*.sentry.io` | Error reports. Optional: blocking it does not affect playback |
| Your own content sources | Only if you add websites, video streams, social feeds or other online content to screens |

If your network blocks WebSockets, screens switch to ordinary HTTPS requests to the same service host on their own — content and emergency alerts still arrive, a few seconds later.

## TLS inspection

Exempt the destinations above from SSL/TLS inspection. Screens verify server certificates and will not connect through an inspecting proxy whose certificate they do not trust.

## Bandwidth and outages

- Content is downloaded **once**, checked against its fingerprint and stored on the screen. After that, traffic is mostly small status checks and changes.
- Large videos download in short, resumable steps, so a slow or interrupted connection picks up where it left off instead of starting again.
- If the internet connection drops, screens keep playing their stored content and catch up when the connection returns. A screen that is already showing an emergency alert keeps showing it until an all-clear arrives.

## Dashboard users

Staff who manage screens only need a modern web browser with HTTPS access to `venue-os.app` and the VenueOS service host above. Nothing is installed on their computers.

## Integrations

Single sign-on, point-of-sale menus, social feeds and other integrations connect **from the VenueOS cloud to the provider**. Nothing connects into your network.

## Still blocked?

Email support@venue-os.app with the screen's name and what it shows, and your firewall or web-filter product if you know it. We will help your IT team find the rule that is in the way.
