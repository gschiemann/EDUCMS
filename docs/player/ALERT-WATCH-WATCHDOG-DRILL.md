# Alert-watch watchdog — the on-glass drill (Manager wave 5, 2026-11-08)

**Class:** life safety, CHANGE. This feature does not reach `master` until a
different-vendor review has read `apps/player/manager/.../alertwatch/` and
`apps/player/app/.../alertwatch/AlertWatchStamp.kt` /
`AlertWatchKickReceiver.kt`, and this drill has passed on the bench classes
below. Triggering a live alert from an agent session is L0; every alert in this
drill is a DRILL on a bench screen in a test tenant.

**What is being proved.** The companion Manager can tell, from outside the
Player's process, whether the native alert watch is alive while the panel is
dark, and can bring it back without lighting the panel, without touching the
hold, and without looping. Nothing here changes what the watch itself does
with an alert; that is covered by `docs/player/HARDWARE-QUAL-CHECKLIST.md`
(the emergency-drill row) and must still pass on the same build.

## Build

One unified field candidate (`x.y.z-field.N`, Manager version equal to the unit
version so the companion renames with it), delivered through `/super/field-builds`
to bench screens only, one hardware class at a time, off-hours. Both APKs must
report on the dashboard (`Player x.y.z-field.N · Manager x.y.z-field.N`).

## Classes

| Class | Why it is in the drill | Dark state to drill |
|---|---|---|
| **GUQ55** (Goodview, Amlogic t982, Android 11) | Vendor-backlight standby: Android awake, backlight off, `isInteractive` true. The Manager must read the Player's `panel_dark` stamp, not its own `PowerManager`. Deep standby reboots this box; the watchdog must never trigger one. | Dashboard "Turn panel off" (vendor backlight) and a remote-off user standby |
| **M43 / L55VEC** (Android 13) | The modern-Android case: background broadcast and FGS-start rules on API 33; the restart-host rung's `startForegroundService` from a cross-package receiver is the uncertain call here. | Schedule-dark (device-admin lock or screen timeout — whatever the box resolves) |
| **FUH43** (Android 9, WebView 66) | Oldest API in the fleet; no FGS-start restrictions, but the OEM ROM drops receivers. Proves the kick receiver is delivered to a stopped-state package. | Remote-off user standby |
| **DH43 double-sided** (one rk3288, two faces) | The echo class: one process, two faces, one stamp with `faces=2`. Proves one ladder, never two, and that a kick does not disturb the back face. | Both faces dark (schedule) |
| **EP6N** (RK3576, sleep through `sdkapi`) | The Player's heartbeat keeps writing while blanked; the watch is expected to poll. Proves the Manager reads "dark" and "healthy" together. | Dashboard "Turn panel off" |

## Steps per class

Record every timing in the table at the end. Clocks: use the device's own log
lines (`adb logcat` where reachable; the diagnostics upload otherwise) and the
dashboard's Device card ("Alert watch" row).

### 0. Baseline (watchdog off)
1. `MANAGER_ALERT_WATCH_WATCHDOG` unset. Install the candidate; pair; play content.
2. Turn the panel off. Confirm the Device card shows NO "Alert watch" row, and
   that `logcat` shows the Player's `NativeAlertWatch` polling every 15 s.
3. Run a DRILL alert (test tenant). Confirm the panel lights and paints
   (`PLAYER_NATIVE_ALERT_CONFIRMED`). All-clear. **This is the control: the
   existing watch, unchanged.**

### 1. Observe mode
1. Set `MANAGER_ALERT_WATCH_WATCHDOG=observe:<screen uuid>`; wait for the
   manifest to refresh (`display.alertWatchWatchdog: "observe"`).
2. Turn the panel off. Within 2 min the Device card reads **"Native alert
   watch alive behind the dark panel · Observe mode"**. Record the time from
   panel-off to the row appearing.
3. Kill the watch without killing the process (see "How to kill the watch").
   Within ~6 min (2 min stale + 4 ticks) the card reads **"silent — observed,
   nothing sent"**. Confirm NO `PLAYER_ALERT_WATCH_KICK` line in the Player
   log, the panel stayed dark, and the Player's heartbeat kept coming.
4. Turn the panel on, then off again: the row returns to healthy within 2 min.

### 2. On mode — recovery
1. Set `MANAGER_ALERT_WATCH_WATCHDOG=on:<screen uuid>`.
2. Turn the panel off; confirm healthy.
3. Kill the watch (method A). Record:
   - T0: the kill.
   - T1: `MANAGER_ALERT_WATCH_KICK step=rearm` in the Manager log and
     `PLAYER_ALERT_WATCH_KICK step=rearm lagMs=…` in the Player log
     (expected T0 + ~6 min).
   - T2: the next `native alert watch: … poll` line, and the card reading
     **"Native alert watch back after the companion's intervention"**.
   - The panel stayed DARK throughout (photograph it next to the dashboard).
4. **Run a DRILL alert while the panel is still dark**, after T2. The watch
   must raise it within 15 s of the manifest changing, exactly as in the
   baseline. All-clear. Record raise latency.
5. Kill the watch with method B (the host service). Record T1 (re-arm), T1'
   (`step=restart-host`, expected T1 + 2 min), T2 (recovery or
   **"still silent after re-arm and restart — NOT natively watched"** at
   T1' + 3 min). Whatever the outcome, the panel stayed dark and the
   Player's content heartbeat kept flowing.
6. Run a DRILL alert again. If the card said UNRECOVERED, the alert is
   expected NOT to wake the panel natively — write that down; it is the
   finding the watchdog exists to surface, and the control for the
   "report" rung.

### 3. No-loop
1. Keep the watch dead (method B repeated after each recovery attempt, or a
   build with the watch loop disabled). Leave the panel dark for 90 min.
2. Expect exactly: one re-arm, one restart-host, one UNRECOVERED, then
   silence from the Manager (`MANAGER_ALERT_WATCH` lines stop). The 24 h
   count on the card reads 2.
3. Flick the panel on/off every 5 min for 30 min. Expect **no** new kick
   (`silent — backing off`) until 30 min after the first ladder started;
   then one new ladder at most.

### 4. The hold
1. Panel dark, watchdog on, watch healthy. Run a DRILL alert; the panel
   lights. While the hold is up, kill the watch (method A).
2. Expect the card to read **"Alert hold up — the Player's own paint ladder
   owns the screen"** and NO kick for as long as the hold stands. All-clear;
   the panel goes back to its pre-alert state; within ~6 min the ladder may
   now run — that is correct.

### 5. Stale Player heartbeat (deferral)
1. Panel dark. `adb shell am force-stop com.educms.player` (or pull power to
   the box's Wi-Fi and wait for the liveness watchdog on a box without adb).
2. Expect the card to read **"Player heartbeat stale — the liveness watchdog
   owns it"** and no kick from this watchdog; the existing WatchdogService
   relaunches the Player as it does today.

### 6. DH43 only
1. Both faces dark, watchdog on. Kill the watch. Expect ONE ladder
   (`faces=2` on the card), and the back face's content heartbeat
   uninterrupted.

### 7. GUQ55 only
1. Dashboard "Turn panel off" (vendor backlight; Android stays awake). Confirm
   the card reads healthy (the Manager's own `isInteractive` says true; the
   stamp's `panel_dark` says dark). Kill the watch; expect the ladder. Confirm
   the box did NOT reboot (uptime unchanged) and the backlight stayed off.

## How to kill the watch (without killing the Player)

- **Method A — the loop.** The debug build only: a hidden bridge/debug
  action is NOT part of this wave. Use the operator setting that disables
  the watch's screen-off receiver if one exists in the candidate; otherwise
  use `adb shell am broadcast` to a debug-only receiver added for the drill
  (must never ship in a release build), or method B.
- **Method B — the host.** `adb shell am stopservice
  com.educms.player/.heartbeat.HeartbeatService` while the panel is dark.
  The watch's loop may survive (its coroutine scope is process-wide), but the
  minute-kick stops; the stamp then goes stale only if the loop also exits.
  To be sure, follow with `adb shell am kill com.educms.player` is NOT valid
  here (that is method C, the liveness case).
- **Method C — the process.** `am force-stop` is step 5 (deferral), not a
  watch kill.

If neither A nor B can make the stamp go stale on a class, write that down:
it means the Player's own self-heal (minute kick + 15-minute alarm) covered
the fault before the Manager could see it — a PASS for the Player, and the
watchdog's rung 1 is then unproven on that class.

## Timings to record

| Class | Dark method | Row appears (s) | Kill → re-arm (s) | Re-arm → recovery (s) | Drill alert raise after recovery (s) | Restart-host reached? | UNRECOVERED reached? | Panel stayed dark? | Reboot? | Loop bound held (90 min)? |
|---|---|---|---|---|---|---|---|---|---|---|
| GUQ55 | | | | | | | | | | |
| M43 / L55VEC | | | | | | | | | | |
| FUH43 | | | | | | | | | | |
| DH43 | | | | | | | | | | |
| EP6N | | | | | | | | | | |

## Pass criteria

- Every class: the baseline drill raises; the post-recovery drill raises
  within 15 s; the panel never lit for a non-alert reason; no reboot; the
  no-loop bounds held; the hold and the stale-heartbeat cases stood down.
- The Device card showed every verdict within one heartbeat of the Manager
  recording it (≤ 60 s while dark).
- A class where rung 2 (`restart-host`) is refused by the OS is NOT a fail —
  the record says UNRECOVERED and that is the honest fact; write the OS
  version and the refusal line into the hardware-qualification matrix note.

Nothing in this document has been run. Until it is, the feature stays
`observe`-only on bench screens and unset for the fleet.
