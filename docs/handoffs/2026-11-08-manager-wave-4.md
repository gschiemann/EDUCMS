# Manager wave 4: scheduled restart policy (deep-dive item #7)

Branch `claude/scheduled-reboot-policy`, cut from `origin/fable/manager-unified-release` (PR #270). Author: Claude Opus 5.5 (Claude Code, worktree agent). Nothing pushed, tagged or dispatched.

## 1. What exists today (research, before any code)

| Piece | Where | What it means for a scheduled restart |
|---|---|---|
| Remote reboot | `apps/web/src/components/screens/ScreenDisplayControls.tsx` (typed `REBOOT` confirm) → `POST /api/v1/screens/:id/display-control` → `runDisplayControl` → `DisplayService.applyAction` (`apps/api/src/display/display.service.ts`) | One dispatch path, already gated on the screen's own capability verdict and already audited (`SCREEN_DISPLAY_REBOOT`, a refusal too). A scheduled restart must use this path and nothing else. |
| Who can reboot | `apps/player/.../display/DeviceOwnerRebootProvider.kt`, `DisplayControlRegistry.kt`, `packages/api-types/src/display-control.ts` (`DisplayRebootMechanism = 'device-owner' \| 'none'`) | **Only a device-owner (or platform-signed) build can reboot.** The owner's rule is NO device owner, ever, so on today's fleet every screen reports `reboot: 'none'` and the API refuses REBOOT with `DISPLAY_REBOOT_UNAVAILABLE`. No unprivileged Android API reboots a box. This feature therefore restarts **no screen on today's fleet**; it lights up per screen the day a build that can reboot reports `reboot: 'device-owner'` (a manufacturer-preinstalled build), with no further code. The dashboard says so per screen. |
| On/off schedule | `DisplaySchedule` rows (screen beats group beats tenant), run on the device; server port of the window math in `apps/api/src/notifications/customer-alerts/schedule-windows.ts` (`windowsForScreen`, `desiredOnAt`) | A restart runs only while the schedule says OFF, and only if it stays OFF for the whole proof window. Owner rule (2026-10-03): the player respects a remote power-off; the schedule overrides it at each edge. A restart must not become a third actor that lights a panel someone turned off: a screen whose panel is off **without** a schedule saying so is skipped. |
| t982 deep standby (GUQ / M43 / L55VEC) | memory 2026-11-02; `docs/handoffs/2026-11-08-manager-deep-dive.md` (BootReceiver fires on every t982 nightly reboot) | Goodview's own CMS sleeps with `CmdPowerOff(-1)` and its wake **reboots** the box. A box in that standby is offline (no heartbeat) and is skipped; a box that already rebooted itself is detected by uptime (below) and skipped. We never send a power command and never write a device setting: the only "write" is the REBOOT, after reading the screen's state. |
| EP6N (RK3576) sleep | `apps/player/.../display/RkSdkApiPolicy.kt` | The wake setter brings the panel back **by rebooting** (`BOOT_COUNT` stepped 18703 → 18704). An EP6N on an on/off schedule therefore restarts every morning already; uptime shows it and the policy skips it. |
| Fleet push rules | `apps/api/src/player-ota/fleet-push-policy.ts` | Reused: `hardwareClassOf` (one class at a time), `localTimeIn`/`OFF_HOURS` (22:00–06:00 in the screen's own zone, unknown zone refuses). |
| OTA in flight | `apps/api/src/player-ota/push-tracking.ts` `pushIsActive`; `Screen.lastOtaState/lastOtaAt` | Reused: no restart while a tracked push is active or the device last said DOWNLOADING / VERIFYING / INSTALLING within 30 min. |
| Emergency | `apps/api/src/display/display-emergency-hold.ts` `resolveEmergencyHold` | Read-only reuse (no emergency code changes). Any hold, including `unreadable`, blocks the restart (fail closed). |
| Sync live moment | `apps/api/src/screens/screen-sync.ts` (`resolveScreenSync`; sync is on the playlist since 2026-09-16, legacy group `syncMode`) | A frame-locked screen restarts only inside its schedule's OFF window; frame-locked with no schedule = "may be live", skipped. A sync read that fails counts as locked. |
| Proof a box restarted | `Screen.nativeRuntimeReport` (`apps/api/src/screens/native-runtime.ts`): `elapsedRealtimeMs` (uptime) and `proc.boot` (Android `BOOT_COUNT`), stamped `nativeRuntimeReportAt` | Read-before-write: uptime = `elapsedRealtimeMs + (now − reportAt)`. Return proof: a check-in after the dispatch with `proc.boot` greater than the one recorded at dispatch. |
| Not-back emails (#202) | `apps/api/src/notifications/customer-alerts/` | **They already apply, unchanged.** The dispatch writes the `SCREEN_DISPLAY_REBOOT` audit row, which the email worker reads as maintenance evidence (30-min grace, `customer-alert-emails.service.ts`). A screen dark during its OFF window is intended downtime, and if it has not checked in at the schedule's switch-on the existing `missedOnTime` rule emails "didn't come back on at 7:00 AM". A screen with no schedule gets the ordinary offline email after the grace. No email code changes in this wave. |
| Vendor recipes | `display_vendor_recipes` (`DisplayVendorRecipe`, platform-owned; shape `{ vendorId, match, brightness?, blank?, wake? }`) | No recipe carries a reboot, and none may: the device allowlist forbids shells and privileged broadcasts. Not used. |

## 2. Design

**Policy (opt-in, per screen group).** New table `screen_reboot_policies`: one row per group (`screen_group_id` unique), `cadence` `DAILY` \| `WEEKLY`, `day_of_week` (weekly only), `time` "HH:MM" in each screen's own zone, `is_active`. No row = today's behaviour (never a restart). The time must be off-hours: 22:00–04:59 (validated on write), so the dispatch window always ends by 06:00. Per hardware class is enforced at run time (one class at a time per tenant), not as a separate setting.

**When a restart may run** (pure: `apps/api/src/scheduled-reboot/scheduled-reboot-policy.ts`, every refusal has a test):

1. Due: now is inside `[slot + jitter, slot + 60 min)` in the screen's zone, on the policy's day. A missed window is never caught up (no 9 AM surprise).
2. Off-hours: 22:00–06:00 in the screen's own zone; a zone that does not resolve refuses (`no-time-zone`).
3. Off window: when the screen has an on/off schedule, it must say OFF now and still OFF at `now + return window` (`outside-off-window`).
4. Panel off without a schedule (remote / dashboard power-off): skip (`panel-off`) — owner rule, never re-light it.
5. Sync: frame-locked and no OFF schedule = may be live (`sync-live`).
6. Emergency: any hold, unreadable included (`emergency`).
7. OTA in flight: tracked push active, or DOWNLOADING / VERIFYING / INSTALLING in the last 30 min (`ota-in-flight`).
8. Offline (no ping in 5 min) — includes a Goodview deep standby (`offline`).
9. Restarted on its own within the cadence (uptime < 23 h daily, < 7 d − 1 h weekly) — covers the t982 wake reboot and the EP6N wake reboot (`restarted-on-its-own`).
10. Cannot restart: the screen's verdict is not `reboot: 'device-owner'` (`cannot-restart`). Every screen today.
11. Mass-action limits (wait, not skip, until the window closes): per-tenant cap per night (`SCHEDULED_REBOOT_TENANT_CAP`, default 20), at most 3 per tenant per tick, and **one hardware class at a time per tenant**: a class waits while another class's restart is still unproven (`class-busy`, `tenant-cap`). Jitter: a stable per-screen offset in 0–45 min from a hash of (screen, slot).

Reasons 6, 7 and 11 are transient: the run row waits (`WAITING`, reason kept) and is retried each tick; when the window closes it becomes `SKIPPED` with the last reason. The others are recorded as `SKIPPED` at once.

**Run record.** New table `screen_reboot_runs`, one row per (screen, slot), unique — creating it is the claim, so two replicas or two ticks can never send twice. Status: `WAITING` → `SKIPPED` \| `SENT` \| `REFUSED` (the API's own gate said no) \| `UNDELIVERED` (no live push channel / fan-out down); `SENT` → `BACK` (check-in after dispatch; `restart_proven` true when `BOOT_COUNT` advanced) \| `NO_RESTART` (checked in, boot count unchanged after the window: the command did not restart it) \| `NOT_BACK` (no check-in within `SCHEDULED_REBOOT_RETURN_MINUTES`, default 15) → `LATE` if it checks in later. The dashboard shows `NOT_BACK` as "Didn't come back after its scheduled restart".

**Execution.** A leader-leased worker (`LEASE.SCHEDULED_REBOOT`, 5-min tick) builds facts per screen in opted-in groups (tenant-scoped queries) and dispatches through `runDisplayControl` with `userId: null` and `reason: scheduled-restart:<policyId>`, so the API's capability gate, delivery honesty and `SCREEN_DISPLAY_REBOOT` audit row are the same as the manual button. No device code changes.

**Audit.** `SCHEDULED_REBOOT_POLICY_SET` / `SCHEDULED_REBOOT_POLICY_DELETED` per configuration change (who, before → after); every executed restart has the display path's `SCREEN_DISPLAY_REBOOT` row plus its run row; a `NOT_BACK` writes `SCHEDULED_REBOOT_NOT_BACK`.

**Kill switch.** `SCHEDULED_REBOOTS_DISABLED=1` (lead flag): the worker does nothing, writes are refused (409 `SCHEDULED_REBOOTS_DISABLED`), the dashboard says restarts are paused. Unset = the feature is available, and still restarts nothing until an admin opts a group in. Failure direction: **closed** — any fact that cannot be read refuses the restart.

**UI.** The group ⋮ menu on Screens gains "Scheduled restart…", opening a sheet in the house pattern of the on/off schedule sheet: off / nightly / weekly, day, time, and a per-screen list (class, whether it can restart, why not, last result). en/es/zh.
