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

## 3. What was built (report)

Commits on `claude/scheduled-reboot-policy` (on top of `origin/fable/manager-unified-release` d92cea5c7; #270 still OPEN at the time of writing, so no rebase onto master): `918bf34df` design · `1e5066983` API + schema + env · `49ec0dbdd` web sheet + strings · `d26715b98` WebKit e2e + layout fix · plus this report.

| File | Why |
|---|---|
| `packages/database/prisma/schema.prisma` | `ScreenRebootPolicy` (one per group, opt-in) and `ScreenRebootRun` (one per screen+slot, the claim); `ScreenGroup.rebootPolicy` relation (no DB change). |
| `packages/database/prisma/migrations/20261108120000_screen_reboot_policies/migration.sql` | Two new empty tables, indexes, FK to `screen_groups` only (no FK to the hot `screens`); `IF NOT EXISTS` + `pg_constraint` guard + `lock_timeout`. |
| `apps/api/src/scheduled-reboot/scheduled-reboot-policy.ts` | Pure rules: slot + jitter, every refusal, uptime/boot/panel/OTA facts, proof of return, env parsing. |
| `apps/api/src/scheduled-reboot/scheduled-reboot.service.ts` | Leader-leased 5-min worker; tenant-scoped reads; dispatch through `runDisplayControl` (userId null); return proof; `SCHEDULED_REBOOT_NOT_BACK` audit. |
| `apps/api/src/scheduled-reboot/scheduled-reboot.controller.ts` | `GET/PUT/DELETE /api/v1/scheduled-reboots/groups/:groupId`; tenant + screen-scope check; audit before/after; 409 under the kill switch. |
| `apps/api/src/scheduled-reboot/scheduled-reboot.module.ts`, `apps/api/src/app.module.ts` | Registration (one import line, one module line). |
| `apps/api/src/realtime/leader-lease.service.ts` | `LEASE.SCHEDULED_REBOOT` (one entry). |
| `apps/api/src/config/env-schema.ts`, `docs/ENVIRONMENT.md`, `.env.example` | `SCHEDULED_REBOOTS_DISABLED` (kill switch, closed), `SCHEDULED_REBOOT_TENANT_CAP`, `SCHEDULED_REBOOT_RETURN_MINUTES`; hand-kept row + regenerated block. |
| `apps/api/src/scheduled-reboot/*.spec.ts` | 53 tests: every blocked condition, slot/jitter/weekly/DST-free math, return proof, kill switch, leader, tenant isolation, audit, scope, validation. |
| `apps/web/src/hooks/use-scheduled-restarts.ts` | Query/mutations (no polling, no focus refetch). |
| `apps/web/src/components/screens/ScheduledRestartModal.tsx` | The sheet (shared `Segmented`, `TimeField`, `StatusPill`; house sheet pattern). |
| `apps/web/src/components/screens/v3/ScreenOperationsV3.tsx`, `apps/web/src/app/[schoolId]/screens/page.tsx` | Group ⋮ → "Scheduled restart…" (optional prop, additive). |
| `apps/web/src/i18n/messages/{en,es,zh}.json` | New top-level `scheduledRestart` namespace (no edits to existing keys). |
| `apps/web/src/components/screens/__tests__/ScheduledRestartModal.test.tsx`, `apps/web/tests/e2e/scheduled-restart.spec.ts` | Web Jest (9) and WebKit e2e on the real route (2). |

No Kotlin change: the device already executes `REBOOT` through `DisplayControlApi` when it can. Nothing touched in diagnostics, Manager health, the install tap or the alert watch; emergency code only read (`resolveEmergencyHold`).

### Commands and results

- `cd apps/api && npx jest src/scheduled-reboot` — 3 suites, 53 passed.
- `cd apps/api && npx jest src/scheduled-reboot src/realtime/leader-lease src/config src/controller-prefix src/display src/app.controller` — 389 passed, 1 failed: `env-schema.spec.ts` completeness, for `MANAGER_SELF_UPDATE_LEGACY_LANE` and `USB_EXPORT_FOLDER_NAME` — **pre-existing on the base branch** (both read by files this wave did not touch; `node apps/api/tools/check-env-declared.cjs` reports the same 2 errors). The lead's #270 needs those two rows declared.
- `cd apps/api && pnpm run build` — exit 0 (`dist/scheduled-reboot/*.js`).
- `node apps/api/tools/check-tenant-isolation.cjs` — OK, 0 unscoped.
- `node apps/api/tools/generate-env-docs.cjs --check` — ok for both files.
- `node scripts/check-schema-has-migration.cjs` — OK. Migration applied **twice** on a scratch Postgres 16 (both exit 0, second all "already exists, skipping").
- `cd apps/web && npx tsc --noEmit -p .` — 0 errors. `npx jest src/components/screens/__tests__/ScheduledRestartModal.test.tsx` — 9 passed; `npx jest src/components/screens/v3` — 367 passed.
- `node apps/web/tools/check-i18n-parity.cjs` — OK (7371 keys each). `node apps/web/tools/check-mobile-perf.cjs` — OK.
- `E2E_BASE=http://localhost:3417 SR_SHOTS=… npx playwright test -c playwright.sandbox.config.ts tests/e2e/scheduled-restart.spec.ts --project=webkit` — 2 passed (reachability from `/[schoolId]/screens` via the group ⋮ menu, Save sends `{cadence:'DAILY',dayOfWeek:null,time:'03:00',isActive:true}`, no sideways scroll at 390).
- `node scripts/check-rulebook.cjs` — PASS.

Screenshots (WebKit; `docs/research/` is gitignored, so they live on the lead's machine only): `docs/research/2026-11-08-manager-waves/wave-4/` — `screens-1325.png`, `group-menu-1325.png`, `sheet-weekly-1325.png`, `sheet-saved-1325.png`, `sheet-weekly-390.png`, `sheet-saved-390.png`.

### A bug caught on the way

`{ id: groupId, tenantId, ...scopedGroupWhere(req) }` would have let the scope's `{ id: { in } }` **replace** the requested id, so a screen-scoped person could write to whichever of their groups Prisma returned first. Fixed with `AND: [scopedGroupWhere(req)]` and pinned by a test. A grep for the same spread shape elsewhere in `apps/api/src` found none.

### Not verified / open

- **No screen on today's fleet can restart remotely** (every verdict is `reboot: 'none'`, by the no-device-owner rule), so the worker has never sent a real REBOOT and the restart → check-in → `BOOT_COUNT` proof is unit-tested only. It needs a platform-signed or manufacturer-preinstalled build on a bench screen to prove on glass.
- Whether each class re-applies its OFF (scheduled sleep) after a boot inside the off window, so a restart at 03:00 does not leave a panel lit until 07:00. `PowerIntentPolicy` and the schedule re-arm on `BOOT_COMPLETED` suggest yes; not observed on hardware.
- The `restarted-on-its-own` skip relies on `nativeRuntimeReport.elapsedRealtimeMs` being fresh (< 2 h). It is not proven that a t982 box in deep standby (Goodview owns power) or an EP6N reports it the morning after the wake reboot.
- Phone: the Screens list on a phone has no group ⋮ for a group that **has** screens (only for an empty group), so on a phone neither "On/off schedule" nor "Scheduled restart" is reachable for a populated group. That is pre-existing layout, not changed here; the 390 screenshots open the sheet at desktop width and then narrow the window.
- The emails from #202 were not changed and not exercised end to end against a scheduled run; the reasoning that they apply is in §1.
- The worker sends nothing in `NODE_ENV=test` and has not run in a deployed environment.
