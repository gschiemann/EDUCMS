---
title: Emergency system overview
category: Emergency System
updated: 2026-09-08
excerpt: How lockdown, weather, and evacuation alerts work — and the safeguards that keep them reliable.
---

# Emergency system overview

The emergency system is the most load-bearing feature in VenueOS. It's designed to be **reliable**, **auditable**, and **resistant to misuse** — in that order.

## What it does

A triggered alert instantly replaces whatever is showing on targeted screens with a full-screen emergency template. Four built-in types:

- **Lockdown** — red, "secure in place, follow ALICE protocols"
- **Shelter in place** — amber, for weather or nearby incidents
- **Fire / Evacuate** — blue, with your building's evacuation map if uploaded
- **Weather alert** — custom text + media (e.g. severe thunderstorm)

You can scope an alert to:

- **The whole tenant** (every screen in the school)
- **A screen group** (e.g. exclude early-childhood rooms)
- **A single device** (for targeted classroom alerts)

## How it's triggered

Three paths, in order of ease:

1. **Dashboard panic button** (top-right corner of every page, admins only)
2. **Mobile panic page** at `/panic` — requires a **3-second hold** on the button to prevent accidental taps
3. **Programmatic API** at `POST /api/v1/emergency/trigger` — for integration with your existing incident system

## What happens under the hood

When an alert fires, the API:

1. Works out which screens are in scope (for a district-wide alert, this reads your school tree from the database)
2. **Signs the message** with a server-side secret (HMAC)
3. Publishes it to the Redis channel for that scope — **this starts before the database writes finish**, so a slow database write can't hold up a lockdown
4. Updates the tenant's `emergencyStatus` and `emergencyPlaylistId` in the database
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

- **Push** — Redis → WebSocket, with an SSE fallback if the WebSocket upgrade is blocked (common behind school content filters)
- **Poll** — an **HTTP request** to the screen's device-authenticated manifest at `/api/v1/screens/:id/manifest`, which carries the live `emergency` field from the same source of truth

If Redis is down, the polling path still delivers the alert. If the push channel is blocked at the network layer, the polling path still delivers the alert. That is real redundancy and it covers the failure we see most often.

Be clear about what it does not cover. Both paths terminate at the same VenueOS API and the same database — those are shared dependencies, not redundant ones, and an outage that takes out both stops new alerts on both paths. A screen that is powered off, unplugged from the network, or behind a filter blocking all of our endpoints receives nothing until it comes back.

One thing does survive a screen-side outage: a screen that was **already showing an alert** keeps showing it through a reboot or a network drop, from a local cache, until it receives an all-clear. Losing the network mid-lockdown does not clear the lockdown.

## All-clear

Clearing an alert is explicit: `POST /api/v1/emergency/:overrideId/all-clear`. You cannot "time out" an alert — someone has to affirmatively cancel it. This is by design. Every clear is also logged.

## Safeguards — do not weaken

Before you change *anything* about the emergency system, you need explicit sign-off from your district's integration lead and legal counsel. Specifically:

- **Never skip the AuditLog** write. Every trigger and clear must be logged.
- **Never weaken either verification layer** — the server-side HMAC gate on the Redis fan-out, or the screen-side signature / freshness / replay gate.
- **Never add a bypass** for the 3-second hold on `/panic`.
- **Never extend trigger permissions** beyond SCHOOL_ADMIN, DISTRICT_ADMIN, and SUPER_ADMIN (plus the `@AllowPanicBypass()` decorator for specifically delegated users via `canTriggerPanic`).

See [delegating panic access](/help/panic-delegation) for the correct way to let a non-admin trigger alerts.

## Testing

We strongly recommend running a **silent test** at the start of each school year:

1. Pick a test screen group ("Admin Office Only")
2. Trigger each of the four alert types against that group
3. Verify each one renders correctly and the audit log captures the event
4. Clear each one and confirm screens return to normal

Don't test against the whole school. Students and staff do not need mystery lockdown drills from a software test.
