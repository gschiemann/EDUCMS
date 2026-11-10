# 02 — Remote app restart (gaps 2 and 9)

**Branch:** `claude/player-app-restart`, cut from `origin/master` at 58ec24c2. Not pushed. **Built by:** build agent B (Claude Opus 5.5, Claude Code). **Status:** built and unit-tested; **nothing is proven on hardware.**

## What already existed (checked in the code)

- Scheduled restarts per screen group (PR #272): `apps/api/src/scheduled-reboot/`, kill switch `SCHEDULED_REBOOTS_DISABLED`, caps, one class at a time, proof of return by boot count. It dispatches `REBOOT` through `runDisplayControl`; every class reports `reboot: 'none'`, so it restarted nothing. Confirmed.
- No "restart the app" command anywhere (API, web, APK). Confirmed (`grep -rn "APP_RESTART\|appRestart"` on master: no hits).
- The relaunch machinery: `ota/RelaunchEscalation.kt` (launch → +8 s proof → overlay retry → notification), the 15-minute `watchdog/Watchdog.kt` tick, START_STICKY `HeartbeatService` (hosts the native alert watch). The player is ONE process (no `android:process` in the manifest), so killing it stops the alert watch too.
- The heartbeat already carries `proc: {pid, at, boot}` in the native runtime report.
- The customer-alert maintenance excuse counted `SCREEN_DISPLAY_REBOOT` audit rows and `app-relaunch` screen events; an app restart writes neither, so it was **not** covered. Fixed (see below).

## What I built

**Device (Kotlin).** `display/AppRestartPolicy.kt` (all rules, pure) + `display/AppRestart.kt` (glue) + `AppRestartReceiver` (manifest, unexported).
- Flow: `displayApply({"action":"APP_RESTART","actionId"})` on the trusted bridge → decide → persist `{id, o:"restarting", pid, history}` → arm an exact alarm at +5 s → answer → at +2.5 s re-check the emergency hold, then `Process.killProcess(myPid)`. The alarm starts a new process: `HeartbeatService.ensureRunning` (alert watch host) → `NativeAlertWatch.kick` → `RelaunchEscalation.attempt(…, RelaunchPurpose.APP_RESTART)` → at +20 s record `landed` / `started` / `not-landed`.
- No device owner, no root: a process may end itself; the alarm lives in system_server.
- Reuses the one relaunch ladder; `RelaunchEscalation` got a `purpose` parameter (own notification text; an app restart never posts `RELAUNCH_BLOCKED` to ota-state) and two helpers made `internal`.
- Capability `appRestart: 'relaunch' | 'none'` added to the probe verdict, auto-detected: trusted channel (WEB_MESSAGE_LISTENER) AND (SDK < 29 OR overlay grant OR Home default) AND no failed landing in 7 days.
- Refusals (reason rides the ack): emergency hold (checked first, and again just before the kill), untrusted transport, not capable, OTA check running or install prompt up, pairing (no device token), setup trip, user standby, process younger than 5 min, < 30 min since the last, ≥ 3 in 24 h, replayed id (record not overwritten).
- Ack by value: `appRestart: {id, o, r?, at}` added to `x-venueos-native-runtime` (`NativePowerControl.report`, one line).

**Gap and failure direction** (also in the code header and `apps/player/CLAUDE.md`): no player code runs from the kill to the new process (≈ 3 s); the alert watch is back ≈ 3–6 s after the kill; content ≈ 8–20 s. An alert raised in the gap is read from the manifest when the watch and the page start. Lost alarm → Android restarts the START_STICKY heartbeat service (alert watch up) and the 15-min Watchdog tick relaunches the Activity: worst case ≈ 15 min dark glass. Refused Activity launch → tap-to-return notification, `not-landed`, 7-day latch → capability `none` → the server's existing 409.

**API.** `APP_RESTART` added to `DISPLAY_ACTIONS` (`packages/api-types`), gated on `verdict.appRestart`, refusal code `DISPLAY_APP_RESTART_UNAVAILABLE`, audit `SCREEN_DISPLAY_APP_RESTART` (dispatch, refusal and emergency refusal). `isDarkeningAction` counts it, so `runDisplayControl` resolves the emergency hold and refuses it like a blank. Same route, same roles (SUPER/DISTRICT/SCHOOL admin), tenant-scoped loader. Verdict storage: 7th key, normalised, unknown → `none`, wire field is a bounded free string so a newer APK never 400s the report. Scheduled restart: `restartActionFor` sends REBOOT if available, else APP_RESTART; proof of return is the new process's ack of the run's `actionId` (`landed`/`started` → BACK proven; `not-landed` → NOT_BACK; `refused` → NO_RESTART). Kill switch and caps unchanged. Customer alerts: `SCREEN_DISPLAY_APP_RESTART` rows now count as maintenance (two lines in `customer-alert-emails.service.ts`). `native-runtime.ts` accepts the `appRestart` block (`.catch(undefined)`) and treats a change as a state change.

**Web.** Player: `APP_RESTART` forwarded to `displayApply` with its `actionId`, dropped over a displayed alert. Dashboard: the existing Restart row in `ScreenDisplayControls` reads "Restart app" (one confirm, `APP_RESTART`) where only the app can restart; a device reboot keeps its button. Mounted: `/[schoolId]/screens/page.tsx` → `ScreenOperationsV3` → `ScreenDetailDrawer` → `ScreenSettingsSections` → `ScreenDisplayControls` (import chain read, not grep only). Where it cannot restart the row is **not rendered** — the owner's 2026-11-01 rule ("a control this screen cannot do is NOT RENDERED", pinned by existing tests); the honest reason is the API's 409 text and the `note.appRestartUnavailable` key on the resolved axis. Scheduled-restart `noneCanRestart` copy rewritten (it said a restart needs full device control). en + es + zh.

## Files changed

`packages/api-types/src/display-control.ts`; `apps/api/src/display/display.service.ts`, `…/scheduled-reboot/scheduled-reboot-policy.ts`, `…/scheduled-reboot.service.ts`, `…/screens/native-runtime.ts`, `…/notifications/customer-alerts/customer-alert-emails.service.ts` + specs (`display.service.spec`, `display-mechanism-drift.spec`, `scheduled-reboot-policy.spec`, `scheduled-reboot.service.spec`, `customer-alert-emails.service.spec`); `apps/player/app/src/main/AndroidManifest.xml`, `display/AppRestart.kt` (new), `display/AppRestartPolicy.kt` (new), `display/DisplayCapabilityProbe.kt` (1 line), `display/DisplayControlApi.kt` (2 lines), `heartbeat/NativePowerControl.kt` (2 lines), `ota/RelaunchEscalation.kt`, test `display/AppRestartPolicyTest.kt` (new); `apps/web/src/app/player/displayControl.ts`, `components/screens/{display-capabilities.ts,quick-settings.ts,ScreenDisplayControls.tsx}`, three locale files, three test files; `apps/player/CLAUDE.md`, `CHANGELOG.md`. **No schema change, no migration, no new environment variable, `versions.properties` untouched.**

## Tests run (real counts)

- `:app:testDebugUnitTest` — 1665 tests, 0 failures, 2 skipped (AppRestartPolicyTest 15/15); `:app:lintDebug` — BUILD SUCCESSFUL.
- API: display + scheduled-reboot + native-runtime suites 16/16, 374 tests pass; customer-alert new case passes; whole API suite 632 suites passed (3 skipped), 12006 tests passed (30 skipped); `tsc -p tsconfig.build.json` clean (the full `tsconfig.json` shows 10 pre-existing errors, all in unrelated spec files).
- Web: 5 touched suites, 244 + 2 new tests pass; `tsc --noEmit -p .` clean.
- `check-i18n-parity.cjs` OK (7518 keys); `scripts/check-rulebook.cjs` PASS.

## NOT proven on hardware — what a bench test must prove per class before any screen gets this

Per required class in `apps/player/HARDWARE-QUALIFICATION.md` (GUQ t982 Android 11 and 13, DH43 rk3288 double-sided, L55VEC, M43, Taurus, X80 …), on a bench screen of a test tenant, filmed:
1. The probe reports `appRestart` honestly: `none` on a box without the overlay grant (Android 10+) and on Taurus (no channel); `relaunch` after granting it in setup.
2. An APP_RESTART from the dashboard: the process ends (new pid in `proc`), the player is back on glass, time to content measured; the ack walks `restarting` → `landed`; the audit row and the scheduled run (BACK, proven) agree.
3. **Emergency:** a drill raised 1 s after the command → refused/withdrawn, alert stays; a drill raised DURING the gap → on glass within the alert-watch/manifest backstop time, measured.
4. Panel blanked by the on/off schedule (soft and hard, incl. vendor-backlight on GUQ): after the restart the panel is dark again; measure any light-up flash (onCreate re-applies the blank, the manifest `turnScreenOn` may light it first).
5. Failure direction: deny the overlay grant after reporting `relaunch` → `not-landed`, notification shown, capability goes `none` on the next probe, server 409s. Kill the alarm (force a lost alarm by `adb shell cmd alarm` or app-standby) → the 15-min Watchdog brings it back; measure.
6. OTA in flight, install prompt up, setup card trip, user standby, pairing → each refused with its reason.
7. Rate limit: a second command within 30 min refused; a scheduled restart never loops.
8. Double-sided DH43: both faces come back; Goodview CMS not disturbed (no device value written).
9. The companion Manager's liveness / alert-watch watchdogs do not intervene during the ≈ 10 s gap.

## Overlap with open PRs

- #294: `DisplayControlApi.kt` (+2 lines in `applyJson`'s `when`). No change to `MainActivity.kt`, `WebAppBridge.kt`, `FacePlayerHost.kt`, `BridgeNonce.kt`, `NativeBridgeChannel.kt`.
- #295: none (`player/page.tsx`, `storageEstimate.ts` untouched).
- Agent A: `heartbeat/NativePowerControl.kt` gets one report field; `PlayerApp.kt`, `watchdog/` untouched.

## Open decisions for the owner

1. **Delivery rides the push channel only** (like REBOOT): a poll-only screen or a wedged page gets `UNDELIVERED`. A heartbeat ride (works with a dead page, the strongest case for a restart) needs a pending-command column on `screens` (an additive migration). Not built; say if you want it.
2. Restart copy on screens that cannot restart: hidden per the 2026-11-01 rule, not shown disabled as the brief asked. Confirm.
3. The 3-per-day / 30-min / 7-day-latch numbers are judgement, not measurement.
4. `SCREEN_DISPLAY_APP_RESTART` (like `SCREEN_DISPLAY_REBOOT`) is not in the customer activity feed.
5. Consequential (fleet action + touches the emergency interlock): needs a different-vendor review and the bench drill above before merge.
