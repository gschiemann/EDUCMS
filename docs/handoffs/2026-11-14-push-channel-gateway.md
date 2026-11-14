# Push channel dead for hours on gateway-mode screens — investigation and fix (2026-11-14)

Audit item 4 (`2026-11-14-fleet-audit.md`): "the daily 5 PM reload of Houston Menu Board Left". The owner's hypothesis was the Goodview's own CMS still holding a shutdown schedule. The evidence below says otherwise for Left; the cause is in our web player. Every claim names its source; read-only throughout (Supabase SQL, Railway API logs and edge HTTP logs, the code).

## Situation

Two RIOT Houston screens ran for hours without a live push channel (the WebSocket/SSE line that pushed alerts, reloads and content changes ride on) while playing normally:

| Screen | Channel lost | Channel back | Gap | How it came back |
|---|---|---|---|---|
| Houston Menu Board Left (`25c5ff17`) | 2026-11-13 18:37:35 UTC | 23:11:13 UTC | 4.5 h | wedge-detector reload at the 24 h re-flag clock |
| Houston Free Standing Kiosk (`e3235417`) | 2026-11-13 19:01:28 UTC (SSE tier lost) | 2026-11-14 09:06:51 UTC | 14 h | its nightly reload |

Left lost the channel every day of the last 7 (`AUTO_RECOVERY_PUSH_DEAD` rows, `lastPushConnectedAt` at flag time): average 10.2 h, worst 15.5 h before recovery.

## Evidence

**Not a device shutdown (Left).** `playback_sample_hours` shows 6 samples in every hour, all night, every night; the page posted `/telemetry` every minute throughout (API `RequestLog`). The box never stopped. The 5 PM time is our wedge detector's 24 h re-flag clock (flag times drift +1 min/day: 17:05, 17:06, 17:07, 17:07, 17:08, 17:09, 17:09 CT), not a device event. The channel itself died at varying times (03:45, 05:06, 03:31, 05:06, 01:40, 16:55, 12:35 CT). Menu Board Right dies at 00:51 CT nightly to the minute (a clock event on the box or its network) and is recovered within 15 min only because its 24 h clock happens to land at 01:01.

**The chain on Left, 2026-11-13 (Railway logs):**
1. 18:37:35 UTC — `[WS] Disconnected … device=25c5ff17` (the socket had been authenticated since 13:59:05).
2. From then to 23:11, **no `New connection`/`Authenticated` line for Left and no `/realtime` request from its WebView (Chrome 87) at Railway's edge.** At 18:39:38 the server dropped several screens across tenants at once; every one of them redialled within 1–2 s — the fleet's reconnect works.
3. Left's HTTP kept flowing — through the **same-origin gateway**: its `GET /screens/25c5ff17…/emergency-rev` arrived every ~5 s from AWS addresses (18.118.27.185, 3.137.174.227, 13.184.136.217 = Vercel egress), all 200, while the other Houston screens polled straight from the site's address (216.74.236.10).
4. 23:09 CT-flag → reload → 23:11:13 `Authenticated` (direct) within 2 s.

**The chain on the Free Standing Kiosk:** WS disconnected 18:46:21 UTC → SSE opened through the gateway 18:46:25 → the stream rotated at 19:01:25 (900 s) → `[SSE] ticket rejected: ticket_expired` (401) at 19:01:28 → no push channel until `Authenticated` at 09:06:51 the next day. It was never flagged: the wedge detector only considers screens whose cache reports are stale, and this one was playing normally.

## Why the product failed (two player defects, one design gap)

1. **The WebSocket followed the control plane onto the gateway.** After 3 network-class failures (1 with a persisted suspicion) the player moves its control plane to the page origin (`apiOrigin.ts`) and never moves back mid-session, by design. `connect()` built the socket URL from `getApiRoot()`, which in gateway mode is the web origin — Vercel, which cannot carry a WebSocket. `apps/web/src/proxy.ts` states the intended design: "WebSocket is not proxied (Vercel cannot); the player keeps WS direct." The code did not. Every redial was guaranteed to fail.
2. **The SSE tier died at its first rotation.** The SSE URL carries a 60-second stream ticket. When a stream ends, `EventSource` reconnects to the same URL — expired ticket, 401 — and the player's rule "two errors without an `onopen` → abandon SSE for the session" turned a routine 15-minute rotation into a permanent loss. The API wrote the requirement when tickets shipped (`apps/api/src/realtime/sse.controller.ts`: "on `es.onerror`, CLOSE the EventSource before retrying"); the player never implemented it.
3. **Recovery waited for a clock and saw only half the cases.** The wedge detector flagged a push-dead screen at most once per 24 h (so Left waited ~10 h a day), and only screens that were also "wedged" (stale cache reports) — a healthy-looking screen with no push channel (the Free Standing Kiosk) was never flagged or reported.

## Why our system let it reach a customer

- The dashboard does not show push-channel state or gateway mode; telemetry carries neither, so 14 h without a push channel looked like a healthy screen.
- The gateway path and the ticketed SSE path have no end-to-end test that rotates a stream or flips origin mid-session; the unit tests covered each piece in isolation.
- The life-safety backstop held, and that hid the problem: the emergency poll ran every 5 s through the gateway, so an alert would have arrived seconds late, not missed. Nothing measured the push channel itself.

## The changes

- **PR `claude/push-dead-reflag-per-outage` (API):** the wedge detector flags push-dead once per outage, not once per 24 h; a new outage is recovered on the next sweep, never within 1 h of the previous flag. Covers defect 3's clock half. Tests: `screen-wedge-detector.spec.ts` (6 new).
- **PR `claude/player-push-channel-direct` (web player):** the WebSocket always dials the direct origin (`getDirectApiRoot()`), whatever the control-plane mode; every SSE error closes the `EventSource` and re-opens through `tryOpenSse` with a fresh ticket, backing off exponentially to 5 min, never abandoning the tier for the session (the 5 s HTTP poll is still the floor from the second error). Tests: `sseRecovery.test.ts` (policy + wiring guards, which fail against the old `page.tsx`), `pushGate.test.ts` updated for the split.

## Also found

- **The vendor's remote-control agent is still active on 19 customer and bench screens.** `screen_device_inventory` reports `com.signway.assistapp/…RemoteControlService` as an enabled Android accessibility service on RIOT Houston (7), RIOT Cleveland (5), Brookfield (5) and ARC IR (3). An accessibility service can read what is on the screen and inject input; this one belongs to the panel vendor's CMS, outside our audit trail. It did not cause the Houston push loss (no evidence links it), but it is a second, unmanaged control path on screens that show life-safety alerts. Recommendation: disable it on every unit (and add the check to provisioning). Inventory snapshots are 2026-10-08 → 2026-11-12, so the current state is unverified.
- `hardwareClass: GENERIC` on the Houston units (APK 1.1.23): they are Goodview rk3288 boards, so class-specific handling and the qualification matrix do not apply to them.
- Every page reload on these screens renews the 180-day device token (`SCREEN_TOKEN_RENEWED` at each forced reload, plus a second daily one), although the rulebook says renewal happens inside the token's last 14 days. Not investigated.

## Left open

- **Defect 3's second half:** a playing screen with no push channel is still neither recovered nor reported. A reload is the wrong tool (the never-interrupt rule declines it on a screen that proves it paints); with the player fix the channel should heal itself, and the dashboard should show push-channel state so a person sees it if it does not.
- Gateway mode never returns to direct mid-session (by design). With the WebSocket direct, a successful direct `AUTH_OK` is proof the direct origin is reachable again; using it to end gateway mode is a design change for the owner.
- Why Left's direct path drops nightly (01:40–05:06 CT) and Right's at 00:51 CT: site network or a scheduled task on the box. Not determinable from server data.

## Validation still owed (unverified until done)

- Both PRs: CI green, a different-vendor review (the player change is on the alert delivery path), the owner's go.
- On glass: on a bench screen, force gateway mode (block the direct API host for 3 requests), confirm the WebSocket re-authenticates direct within 30 s; force an SSE-only screen (block the WebSocket upgrade) and confirm it survives two 15-minute rotations; run an owner-approved drill on that screen while it is on the gateway.
- In production after deploy: `AUTO_RECOVERY_PUSH_DEAD` gaps for Houston Menu Board Left fall from hours to minutes; no `ticket_expired` streak in the API log.

Authored by Claude (Anthropic) in Claude Code on the web — the investigation and both changes (the model is named in the commit trailers); no other vendor has reviewed them yet.
