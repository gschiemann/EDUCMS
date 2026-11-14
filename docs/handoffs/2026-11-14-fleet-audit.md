# Fleet audit — 2026-11-14 (7 days: 2026-11-07 → 11-14)

The owner's ask: "do an audit on how all screens have been running and make sure our player is stable, our web app is updating in off hours and all alerts are real and truthful, nothing missed." Read-only: production database (`screens`, `screen_events`, `screen_alert_incidents`, `audit_logs`), the live health endpoints and the deployed web build. Nothing was changed on any screen or in any data.

## Fleet at 13:05 UTC

| Organisation | Screens | Checking in now | Playing (fresh proof) | Player version |
|---|---|---|---|---|
| RIOT Houston | 8 | 8 | 8 | 1.1.23 |
| ARC IR | 9 | 5 | 5 | 1.1.29 |
| RIOT Cleveland | 7 | 4 | 3 | 1.1.55-field.1 |
| RIOT Portland | 1 | 1 | 1 | 1.1.67-field.1 |
| Brookfield (internal bench) | 20 | 16 | 15 | 7 builds, 1.1.12 → 1.1.66-field.1 |
| VisionCore (internal) | 2 | 0 | 0 | 1.1.42-field.1 |

- API: `/api/v1/health`, `/ready` and `/emergency-path` all `ok` (db, redis, signer), commit `93fce2c`, up 3.7 days. Web: `d50a13d` (= `master`).
- No player crash reported anywhere in the 7 days.
- **Every screen that is checking in runs the current web build `d50a13d`.** The only ones on an older build are offline, or (Cleveland Video Wall) a panel in standby that takes the update when it wakes.

## 1. Player stability

**Stable, with four findings.**

- **Reboots:** 151 in 7 days across 26 screens — about one per screen per night. 138 of them fall 1–6 AM local: the scheduled nightly restarts. 12 happened between 7 AM and 5 PM local; not individually traced, and "local" here falls back to the device's own zone, which is wrong on several boxes, so some of those 12 may really be night-time.
- **Unplanned app restarts:** 4 (process restart) — Cleveland High Brightness Portrait ×2, L55VEC, Portland GUQ-65in. No crash record for any.
- **The wedge detector reloads the same screens on a daily clock** (`push-dead`: the live push channel is gone, so the server asks for a reload through the manifest):
  - Houston Menu Board Left — every day at 23:05–23:09 UTC (**5:05 PM in Houston, during business hours**), 7 times.
  - Houston Menu Board Right — every day at 07:01–07:06 UTC (1 AM Houston), 7 times.
  - Cleveland Video Wall — every day at 4:29 and 4:52 PM ET, right after the panel goes to standby (8 reloads of a screen no one is watching).
  - Bench L55VEC (13) and G75 (11).
  A push channel that dies at the same minute every day is a network or device event on a timer (a router's DHCP lease, a scheduled task on the box). The reload is the right recovery, but the 5 PM one on a customer menu board is visible, and nothing tells anyone the channel keeps dying. **Not investigated further.**
- **OTA failures:** L55VEC (bench) 7 unauthenticated `ota-failed` in 7 days; ARC IR Lobby Menu Board 1.
- **Field builds on customer screens:** Cleveland (1.1.55-field.1) and Portland (1.1.67-field.1) run field builds; Houston (1.1.23) and ARC IR (1.1.29) run old releases. Rule 7 in the core rulebook names this as the Phase 1 gap.

## 2. Web app updates in off hours

**Yes — with one anomaly.**

- 137 web updates applied in 7 days, every one through an allowed path: `nightly` 49, `display-off` 85 (screen blanked by its on/off schedule — including the bench GUQs' weekend off-windows at 1–4 PM), `idle` 3 (nothing on glass, e.g. the Cleveland portrait while it showed its error card).
- **Every `nightly` update with a recorded zone landed 1–5 AM in the screen's own zone**, and the zone is right for every customer screen even where the device's own clock zone is wrong (Houston boards report Africa/Bissau, Africa/Bamako, Europe/Jersey, Asia/Shanghai; the server resolves the site's zone from its coordinates and the player uses that).
- **Anomaly — Houston Video Wall:** its last three updates (Oct 26, Oct 27, Nov 2) were recorded as `nightly` at **7:44 AM Chicago time**. Either it really applied at 7:44 AM (the window logic is wrong for this unit) or the event was recorded late (posted after the panel's network came back). **Unverified which.** It has applied no update since Nov 2 and is on the current build through a reboot.
- No update applied while an alert was on glass (none were live).

## 3. Alerts: real, truthful, nothing missed?

**Emergency alerts.** No live alert in 14 days except three owner-triggered tests on Nov 2–4 (internal tenant). The automated drills on Nov 9–10 found real defects on bench hardware that customers also run:

| Bench screen | Hardware | Result |
|---|---|---|
| GUQ55 | Goodview GUQ | override drill **failed 2 of 2** — the alert board did not stay on the glass (`persistence`) |
| FUH43-L, M43 | Goodview | one `persistence` failure each (override and broadcast) |
| M55SAR | Goodview | one `delivery` failure on a pushed message |
| DH43 (double-sided) | Goodview | never tested — skipped 16 times (`pane-not-listed`: its back face is not on the drill list) |
| G43, G75, GUQ65, L55VEC, M86, TC32, FUH43-R | various | passed |

Customers run the same Goodview class (Portland GUQ-65in, ARC IR DEMO FLOOR 55GUQ). **A life-safety finding: on GUQ55 the alert board does not reliably stay up.** Not investigated in this audit; the drill rows are in `audit_logs` (`EMERGENCY_DRILL_RESULT`).

**Screen-health alerts (offline / no content).**

- **Truthful where they fire.** Every open incident matches the screen's real state:
  - ARC IR: 55in Kiosk (silent 12.6 h), Lobby Menu Board (19 h), NON TOUCH 55 KIOSK (33.5 h), FOOD MENU BOARD (34.6 h).
  - Cleveland: both Double Sided faces and both Menu Boards, silent since 4:35 PM ET yesterday. Overnight this was classed as their normal daily power-down and stayed silent; at 6:41 AM ET they had not come back and the incident opened. That is the intended behaviour.
  - Cleveland Video Wall: `NO_CONTENT` since 4:16 PM ET yesterday — true, the panel is in standby.
- **Nobody outside this company was told.** Every incident is `emailed_mode = shadow`: the email goes to the owner, not the customer. **ARC IR has four screens dark for up to 35 hours and RIOT has five; neither customer has been notified by the product.** Whether the owner received the shadow emails was not checked.
- **Missed — screens that died and never alerted:** LED Poster 1 and LED Poster 2 (bench, silent 24 days) and VisionCore "Venue-OS Media Player" (silent 22 days) have **no incident at all**. They went silent before or outside what the scanner tracks. A screen that is gone for weeks must never be invisible. LED Poster 3 and E6NP (bench) do have incidents.
- **The dashboard is truthful on presence.** The database `status` column stays `ONLINE` for silent screens, but the API derives the live status from the last check-in, so the dashboard shows them offline. Any report or query that reads the raw column directly will be wrong.

## 4. Other things found

- **PR #307 (the security patches) is blocked.** `Web typecheck + build` fails the bundle budget: 19.97 MB against a 19.36 MB ceiling after the Next.js 16.4.5 bump (the rule forbids raising the ceiling). The E2E jobs failed because a shard did not report (532 of 1,064 tests ran, all passed) — a CI fault, not a test failure. **The Next.js and Node security fixes are not live.**
- The API is on `93fce2c`; `master` is `d50a13d`. The difference is web-only (#301, #306), so the API is current in substance.

## What I recommend, in order

1. **Unblock #307** — find what grew the web bundle with Next 16.4.5 and get it back under the ceiling (or take the owner's decision on it); re-run the E2E shard.
2. **GUQ55 alert persistence** — drill it again on the bench and find why the board drops; same class is on customer screens.
3. **Turn customer alert emails on** for RIOT and ARC IR (owner's decision — it emails customers), and alert on screens silent for days that have no incident today.
4. **The daily 5 PM reload of Houston Menu Board Left** — find what kills its push channel at that minute; tell the operator when a screen's channel dies on a schedule.
5. **Houston Video Wall 7:44 AM updates** — establish whether it applies or only reports late.
6. **Add DH43's back face to the drill list** so double-sided units are tested.

Models: Claude Opus 5.5 (Anthropic, Claude Code on the web), lead session. Queries were read-only.
