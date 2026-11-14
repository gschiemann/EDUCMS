# Houston Video Wall applies "nightly" web updates at 7:45 AM — investigation (2026-11-14)

Fleet audit item 5 (`2026-11-14-fleet-audit.md`). Read-only investigation by a sub-agent (Supabase SELECTs, Railway logs, code), checked by the lead session. Screen `dd323527-c5af-46f4-8fb6-84d8392d1335`, tenant RIOT Houston (a customer screen).

## Verdict

**Not recorded late, not a zone-resolution bug.** The screen really reloaded at about 07:44–07:45 Chicago time, outside its window. The player believed it was inside the nightly window because its own clock (`Date.now()`) is most likely **about 4 hours behind** true time. The clock skew is an inference: no table stores the device's raw clock.

Correction to the audit: the nightly window is **03:00–04:00 local** with a per-screen 0–20 minute jitter at the start (`apps/web/src/app/player/offHoursUpdate.ts`, `nightlyWindowOpen`), not 1–5 AM. Fleet data agrees (every other nightly apply is at 03:xx).

## Evidence

- **Not a late post.** The server stamps the row at receive time (`telemetry.controller.ts`: the `update-applied` row is created with no `createdAt`; `recordAll(happened, now)` for `page-reload`). The device's apply time is never sent. Today's event (2026-11-14) is covered by Railway HTTP logs: manifest polls every 60 s from 09:04 UTC, `emergency-rev` every 10 s at 13:45:09/19/29/39 UTC (UA `EduCmsPlayer/1.1.23`, the site's address), new-document boot at 13:45:29 (OPTIONS + GET `/manifest`), `POST …/telemetry` 201 at 13:45:30.543, `update-applied` row at 13:45:30.228 UTC. The box was online throughout; the reload happened at real 07:45 CST.
- **The zone logic is right.** The `update-applied` details on Oct 26, Oct 27, Nov 2 and Nov 14 say `zone: America/Chicago, zoneSource: screen, window: nightly`. Eight sister Houston boxes (same tenant, same player 1.1.23, wrong device zones) all apply at 03:01–03:56 Chicago. Only the Video Wall is off.

| `screen_events.created_at` (Chicago) | UTC | Zone recorded |
|---|---|---|
| 2026-10-23 01:44:39 | 06:44 | Europe/Jersey, source `device` (before the 10-24 zone feature; 07:44 BST) |
| 2026-10-26 07:44:39 | 12:44 | America/Chicago |
| 2026-10-27 07:44:39 | 12:44 | America/Chicago |
| 2026-11-02 07:44:35 | 13:44 | America/Chicago |
| 2026-11-14 07:45:30 | 13:45 | America/Chicago |

  Each sits a constant ~4 h after where that zone's 03:00–04:00 window falls, across BST/CDT/CST and across the switch from device zone to screen zone — exactly what a device clock ~4 h slow produces. Ruled out: a 5–6 h zone mismatch (does not fit a 03–04 window); a frozen WebView (its timers were running).
- **Why the skew matters:** the player computes the window from raw `Date.now()` (`page.tsx` evaluate → `decideUpdateApply({ nowMs: now })`). It already measures the server clock (`serverClockOffsetRef`, from WS AUTH_OK, SSE, and `GET /api/v1/realtime/time` via `relearnServerClockOffset`) but the update window never uses it; only the play log and sync do. `applyUpdate` does not re-check the window at the item boundary either.
- **Fleet sweep (30 days, all tenants):** every other `nightly` row is at local hour 3 (118 device-zone, 166 screen-zone, 5 UTC-zone); only these 5 rows on this screen are at hour 7. The anomaly is ongoing: the next bundle drift will apply at ~07:45 again.

## Smallest correct fix (player code — owner's go)

1. `evaluate()`: decide the window on the server-corrected clock, `Date.now() + serverClockOffsetRef.current` (confirm the sign: the offset is "what to ADD to local `Date.now()` to match the server").
2. Fail closed: if the offset has never been measured, do not take the `nightly` branch (`display-off` and `idle` still apply), or measure it first via `relearnServerClockOffset`.
3. Re-run `decideUpdateApply` inside `applyUpdate` so a boundary armed in the window cannot fire outside it.
4. Add the measured offset to the update evidence so the audit can prove device skew directly.
5. A unit test with a skewed clock in `offHoursUpdate.test.ts`.
6. Field remedy: correct the box's Android date/time (unconfirmed that it is wrong).

## Could not determine

- The device's actual clock (no raw device time is stored; `play_log_entries` empty for this tenant).
- Why the minute is a constant :44–:45 (probably the first evaluate tick after the check/boundary timing).
- Where the Chicago zone comes from for these screens (the screen row has no timezone, coordinates or address).
- Railway log coverage for Oct 23 – Nov 2 (only Nov 14 was queried).
