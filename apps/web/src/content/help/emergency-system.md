---
title: Emergency system overview
category: Emergency System
updated: 2026-04-16
excerpt: How lockdown, weather, and evacuation alerts work — and the safeguards that keep them reliable.
---

# Emergency system overview

The emergency system is the most load-bearing feature in EduSignage. It's designed to be **reliable**, **auditable**, and **resistant to misuse** — in that order.

## What it does

A triggered alert instantly replaces whatever is showing on targeted screens with a full-screen emergency template. Four built-in types:

- **Lockdown** — red, "secure in place, follow ALICE protocols"
- **Shelter in place** — amber, for weather or nearby incidents
- **Evacuate** — blue, with your building's evacuation map if uploaded
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

1. Updates the tenant's `emergencyStatus` and `emergencyPlaylistId` in the database
2. Creates an **immutable AuditLog entry** (userId, severity, timestamp, payload)
3. **Signs the message** with a server-side secret
4. Publishes to the Redis channel for that scope
5. Every paired screen verifies the signature before rendering

If Redis is unavailable, screens fall back to **HTTP polling** every 10 seconds against `/api/v1/emergency/status`. No single point of failure will keep an alert from reaching screens.

## All-clear

Clearing an alert is explicit: `POST /api/v1/emergency/:overrideId/all-clear`. You cannot "time out" an alert — someone has to affirmatively cancel it. This is by design. Every clear is also logged.

## Safeguards — do not weaken

Before you change *anything* about the emergency system, you need explicit sign-off from your district's integration lead and legal counsel. Specifically:

- **Never skip the AuditLog** write. Every trigger and clear must be logged.
- **Never disable signature verification** on the player side.
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
