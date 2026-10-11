---
title: Emergency system overview
category: Emergency System
updated: 2026-10-11
excerpt: How lockdown, weather, and evacuation alerts work, how to run a practice drill, and the safeguards that keep them reliable.
---

# Emergency system overview

The emergency system is the most load-bearing feature in VenueOS. It's designed to be **reliable**, **auditable**, and **resistant to misuse** — in that order.

## What it does

A triggered alert instantly replaces whatever is showing on the targeted screens with the full-screen content you set up for that alert type. The alert types are:

- **Lockdown** — threat inside the building
- **Fire / Evacuate** — leave the building and go to the meeting point
- **Medical** — a medical or first-responder event
- **Secure** — threat outside; lock the perimeter and stay inside
- **Shelter** — severe weather, hazardous material, or an air-quality event
- **Hold** — stay put and clear the hallways

You set the media and text for each type in **Settings → Emergency**. A type with no content sends nothing, so the Readiness panel on that page tells you exactly what is missing before you need it.

When you trigger an alert, the **Send to** line chooses where it goes:

- **All screens** (the default)
- **A screen group** (for example, everything except one wing)
- **A single screen**

## How it's triggered

Two paths, both for people with emergency authority:

1. **The Emergency button** in the top bar of the dashboard. Pick the alert type, type the confirm word shown (for example `LOCKDOWN`), and send.
2. **The mobile panic page** at `/panic`, which requires a **3-second hold** on the button to prevent accidental taps.

Admins and Super Admins can trigger alerts. Anyone else needs the per-person emergency capability — see [delegating panic access](/help/panic-delegation).

There is deliberately **no API-key or integration route** for triggering or clearing an alert. API keys are blocked from every emergency endpoint on purpose: a leaked or over-shared key must never be able to put a lockdown on your screens. If you want an outside system (a badge reader, an incident tool) to raise an alert, a person with emergency authority has to confirm it from the dashboard or `/panic`.

## Live or drill

Every trigger surface — the Emergency button's dialog and the `/panic` page — has a **LIVE | DRILL** switch.

- It **starts on LIVE every time** the dialog or page opens and is never remembered. Flipping it to DRILL is something you do on purpose, each time, so a real emergency can never go out as a practice because a switch was left on yesterday.
- **DRILL** uses indigo instead of red and says "DRILL" in the confirmation sentence. Screens show the drill content with a **"THIS IS A DRILL"** banner, so nobody mistakes it for the real thing.
- **Live always wins.** A drill will not start while a live alert is active, and a live alert that arrives during a drill ends the drill.
- Drill content is set on the **Drill** tab of **Settings → Emergency** (next to **Live**). A type with no drill content plays its live content, still under the DRILL banner. You can also give a single screen its own drill content.
- The **Drill log**, on the same tab, lists recent drills from the audit trail: what ran, where, who started it, and how long it lasted.
- Ending a drill (**End Drill (All Clear)**) uses the same all-clear step as a real alert.

## What happens under the hood

When an alert fires, the API:

1. Works out which screens are in scope (for an organization-wide alert, this reads your location tree from the database)
2. **Signs the message** with a server-side secret (HMAC)
3. Publishes it to the Redis channel for that scope — **this starts before the database writes finish**, so a slow database write can't hold up a lockdown
4. Records the active alert on your organization in the database
5. Creates an **immutable AuditLog entry** (userId, severity, timestamp, payload)

That ordering is deliberate. "On the wall but not yet recorded" is recoverable; "recorded but never shown" is not.

## How a screen knows a message is genuine

Signature verification happens **on our servers, at the broadcast gate** — and that is the stronger place for it, not a compromise. Every message coming off Redis is HMAC-verified against the signing secret and bound to the channel it was published on *before* it is allowed onto the WebSocket or SSE bus. A forged or misrouted channel message is dropped there and never reaches a screen at all.

The signing secret stays on the server by design, so screens can't re-check the HMAC themselves. What each screen independently enforces, on every transport, is a three-part gate on life-safety messages:

- **Signature present** — a message with no signature never passed through the signer, so it's dropped
- **Freshness** — the timestamp must be within 30 seconds of the server-corrected clock (signage players routinely boot without NTP, so the offset is learned from the authenticated session, not the device clock)
- **Replay** — each `eventId` is accepted once, in a cache shared by WebSocket and SSE, so a captured message can't be replayed back on the other transport

## Redundancy — and what it does not cover

Screens receive alerts over two independent transports:

- **Push** — Redis → WebSocket, with an SSE fallback if the WebSocket upgrade is blocked (common behind network content filters)
- **Poll** — an **HTTP request** to the screen's device-authenticated manifest at `/api/v1/screens/:id/manifest`, which carries the live `emergency` field from the same source of truth

If Redis is down, the polling path still delivers the alert. If the push channel is blocked at the network layer, the polling path still delivers the alert. That is real redundancy and it covers the failure we see most often.

Be clear about what it does not cover. Both paths terminate at the same VenueOS API and the same database — those are shared dependencies, not redundant ones, and an outage that takes out both stops new alerts on both paths. A screen that is powered off, unplugged from the network, or behind a filter blocking all of our endpoints receives nothing until it comes back.

One thing does survive a screen-side outage: a screen that was **already showing an alert** keeps showing it through a reboot or a network drop, from a local cache, until it receives an all-clear. Losing the network mid-lockdown does not clear the lockdown.

## All-clear

Clearing an alert is explicit: someone with emergency authority sends the **all-clear** from the dashboard (the active-alerts panel offers *Hold to send all-clear*) or from `/panic`. You cannot "time out" an alert — someone has to affirmatively cancel it. This is by design. Every clear is also logged.

## Safeguards built in

These are fixed parts of the system, not settings:

- **Every trigger and clear is written to the audit log**, including who, when, what type, and whether it was a drill.
- **Two verification layers**: the server-side signature check at the broadcast gate, and the screen-side signature / freshness / replay gate.
- **A 3-second hold** on `/panic`, with no bypass.
- **Who can trigger is narrow**: Admins and Super Admins, plus specific people you delegate to. API keys can never trigger or clear an alert.

See [delegating panic access](/help/panic-delegation) for the correct way to let a non-admin trigger alerts.

## Testing

Run a **drill** at the start of each term or season, and again after any change to alert content or screens:

1. Open **Settings → Emergency** and check the Readiness panel shows every screen ready.
2. Open the Emergency button, flip the switch to **DRILL**, and pick a small target — a test screen group or a single screen — so you don't alarm the whole building.
3. Confirm the screens show the drill content with the **"THIS IS A DRILL"** banner, and that the Drill log records it.
4. End the drill with the all-clear and confirm the screens return to normal.

Only run a whole-building drill when everyone has been told it is coming.
