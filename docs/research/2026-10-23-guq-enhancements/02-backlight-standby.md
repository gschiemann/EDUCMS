# True standby on a Goodview GUQ — the vendor backlight as a blank mechanism (player 1.1.52)

Branch `feat/guq-backlight-standby`, 2026-10-23. Enhancement #2 of `01-report.md`. Nothing here is
hardware-qualified: every claim below is a unit-test or source-level claim until the on-glass checklist
at the end has been run on a GUQ panel.

## What it does

On an Amlogic t982 / IFPDOS panel (M43 / M55 / M65 / M75 / M86 GUQ) the player's BLANK no longer puts
Android to sleep or merely paints black. It binds the panel vendor's own control service — the exact
path the vendor's CloudSign player takes (`bindService("com.ifpdos.opensdk.SERVICE_MANAGER" @
com.seewo.mcuservice)` → `getService("opensdk")` → `getToken(ourPackage)` → `sendMessage(token,
json)`) — and asks the MCU for `CmdSetScreenStatus(false)`: the **backlight goes off while Android, the
app, its WebView and the native alert watch keep running**. WAKE, and every emergency alert, asks for
`CmdSetScreenStatus(true)` through the same call.

New blank/wake mechanism id: **`vendor-backlight`**. It is reported in the existing sleep report
(`sleep.blank`, `sleep.last.m`) plus a new compact `sleep.vb` fact (`d` detection, `off` dark by our
hand, `f` a fault reason), and in `displayCapabilities.verdict.screenBlank`.

## Where it sits

```
BLANK / WAKE   NovaStarTaurus → VendorRecipe → VendorBacklight → DeviceAdminBlank → AccessibilityLock → ScreenTimeout → SoftwareDim
```

After an explicit vendor recipe (a per-model command an operator configured wins over auto-detection),
before every mechanism that sleeps Android. On every box without the vendor service `supports()` is
empty and the chain resolves exactly as in 1.1.51.

## Files

| Side | File | What |
|---|---|---|
| APK | `apps/player/app/src/main/java/com/educms/player/display/VendorBacklightPolicy.kt` | The rules + the wire shapes (pure, JVM-tested) |
| APK | `…/display/VendorBacklightEngine.kt` | The sequence over a `Ports` interface (probe, blank, wake, reconnect, fault latch, emergency ON hand-off) |
| APK | `…/display/VendorBacklightProvider.kt` | The Android half: bind, raw `Parcel` transacts, one worker, bounded waits, prefs, overlay |
| APK | `…/display/DisplayControlRegistry.kt` | Chain position; a failed vendor blank never falls through to a latch-prone lock below Android 13 |
| APK | `…/display/DisplayEmergency.kt` | `enforceNow` asks for the backlight ON **first**, before its first window hook, and never waits |
| APK | `…/display/DisplayConfig.kt`, `DisplayControlApi.kt` | Kill switch `display.vendorBacklight === false`; a switch landing while dark lights the panel then re-blanks via the chain |
| APK | `…/display/SleepProof.kt` | Outcome from the MCU readback (`off` / `on` / `unknown`), `sleep.vb` |
| APK | `…/alertwatch/NativeAlertWatch.kt` | `panelInteractive()` is false while the backlight is off by our hand → the watch polls |
| APK | `PlayerApp.kt`, `AndroidManifest.xml` | Probe at process start; `<queries>` for the vendor package + action (API 30+ visibility) |
| API types | `packages/api-types/src/display-control.ts` | `vendor-backlight` in `DISPLAY_BLANK_MECHANISMS` and `DISPLAY_POWER_PROVEN_MECHANISMS`; `DisplayManifestBlock.vendorBacklight?: false` |
| API | `apps/api/src/display/vendor-backlight-flag.ts`, `display-manifest.ts` | `PLAYER_VENDOR_BACKLIGHT` → `display.vendorBacklight: false` for named screens only |
| Web | `apps/web/src/app/player/displayControl.ts` | Forwards exactly `false` to the device config |
| Web | `apps/web/src/components/screens/display-capabilities.ts`, `sleep-wake.ts`, `i18n/messages/{en,es,zh}.json` | Dashboard: Turn off available with its own note; a real sleep for the glass |
| Docs | `CLAUDE.md` (`PLAYER_VENDOR_BACKLIGHT` row) | |

## The rules (each has a JVM test)

1. **Auto-detected, no setting.** Offered only when the vendor package is installed, the bind completes,
   a token is issued and a `CmdGetScreenStatus` probe answers `SUCCESS` — all within budget
   (`BIND_TIMEOUT_MS` 5 s, `CALL_TIMEOUT_MS` 1.5 s). `HANDLER_NOT_FOUND` = unsupported firmware;
   absent / silent = fall through. An unreachable service is re-probed every 60 s, at most 5 times per
   process. A box that proved the service once is trusted through the next boot's probe, so a persisted
   blank re-applied at process start is not handed to a worse mechanism.
2. **Bounded, off the main thread.** One worker thread; every binder call has a budget; a registry
   `apply` waits at most `APPLY_BUDGET_MS` (1.9 s, inside `EmergencyPaintPolicy.WAKE_BUDGET_MS`); a call
   that outlives its budget is a failure and the worker is replaced. A caller on the main thread never
   waits for a bind (its callback needs that looper) — it fails through.
3. **Emergency first.** `DisplayEmergency.enforceNow` queues the ON on the worker before the first
   window hook and returns; the registry WAKE that follows (bounded, 2 s) asks again; a quiet per-poll
   re-raise asks again only while our record says the backlight is off. A failing or hanging vendor call
   delays nothing that draws the alert.
4. **A fault steps aside for darkening only.** If an ON after our own OFF fails, BLANK is withdrawn for
   the rest of the process; WAKE keeps trying (nothing else can light a backlight the MCU holds off). The
   next successful ON clears the fault.
5. **The kill switch only removes.** `display.vendorBacklight: false` disables the mechanism for that
   screen; absent / `true` / garbage changes nothing. If it lands while the backlight is off by our hand,
   the panel is lit first and the blank re-applied through the remaining chain.
6. **A fall-through from this mechanism never takes a latch-prone lock** on an Android below 13
   (`RestoreBlankPolicy`) — a vendor blank that fails on a GUQ must not become the `lockNow()` that
   latched the G43.
7. **Restore after an alert is 1.1.51's.** `vendor-backlight` is not in `LOCK_FAMILY`, so
   `RestoreBlankAfterAlertPolicy` / `UserStandby.restoreAfterAlertIfDue` re-blank through it on every
   Android; the pre-hold snapshot, "last command wins", and the hard-schedule check are untouched.

Design choices worth knowing: the blank **keeps `FLAG_KEEP_SCREEN_ON`** (Android must stay awake behind
the dark backlight) and **also raises the player's black overlay** as belt and braces for a firmware
whose MCU accepts the command and leaves the glass lit; the dark record is persisted with
`Settings.Global.BOOT_COUNT` (a reboot resets the MCU, so an older record says nothing); no bridge method
was added — BLANK/WAKE ride the existing `displayApply` and resolve natively.

## Server side — one deliberate decision

`vendor-backlight` joined `DISPLAY_POWER_PROVEN_MECHANISMS` (alongside `vendor-recipe`). Without it the
API refuses the dashboard's Turn off (`POWER_OFF`) and routes the on/off schedule soft (web overlay), so
the mechanism would be unreachable from the product. The rationale is the same class of control as a
recipe **by construction**: reversed by the same command, Android awake throughout, no vendor standby
entered — not the admin-lock family's failure shape. It is still **unproven on glass**; if the checklist
below fails, removing that one list entry routes the GUQ class soft again with no APK change.

## Wire shapes (reconstructed statically from CloudSign-V3.1.8-GVBOX; jadx, never run)

* `ISDKServiceManager` (`com.seewo.sdk.internal.model.ISDKServiceManager`): tx 1 `getService(String): IBinder`.
* `ISDKService` (`com.seewo.sdk.internal.model.ISDKService`): tx 1 `getToken(pkg, null): String`, tx 3 `sendMessage(token, json): String`.
* Request = fastjson `SDKRequest`: `{"requestName":"com.seewo.sdk.internal.command.device.CmdSetScreenStatus","paramsJson":"{\"on\":false,\"isOn\":false,\"isAllowIntercept\":true}"}` (`isOn` is written as well as `on` so a firmware that keyed the field name still matches; unknown keys are ignored by fastjson).
* Reply = fastjson `SDKResponse`: `{"status":"SUCCESS"|"HANDLER_NOT_FOUND"|"SERVICE_NOT_FOUND"|"SDK_NOT_CONNECTED","responseName":…,"paramsJson":"{\"result\":true}"}`.

The one thing the static read could not settle is whether the `paramsJson` key names are the getter-derived
`on` / `isAllowIntercept`. Both spellings are sent; the first on-glass probe (`PLAYER_VENDOR_BACKLIGHT`
log lines, `sleep.vb.d`) settles it.

## Kill switch

`PLAYER_VENDOR_BACKLIGHT` (Railway env, API restart): `off` / `0` / `false` / `no` / `-all` = fleet off;
`-<screen uuid>,…` = those screens off; `all` / a bare uuid accepted and change nothing; a typo disables
nothing. Carried as `display.vendorBacklight: false` only for a screen it names, so no other screen's
ETag moves. Default: unset.

## Tests

* Kotlin (JVM): `VendorBacklightPolicyTest` 14, `VendorBacklightEngineTest` 25, `VendorBacklightWiringTest` 12
  — detection/fallback, timeouts, reconnect-once, fault latch, emergency ordering (ON queued before any
  binder call; a hanging/throwing ON never reaches the caller), restore policy, kill-switch parse, wiring.
  Full gate `./gradlew testDebugUnitTest lintDebug`: 1 325 tests across 123 classes, 0 failures;
  `scripts/check-player-test-execution.cjs` green.
* API Jest: `vendor-backlight-flag.spec.ts` 6, `display-manifest.spec.ts` +5, `display-mechanism-drift.spec.ts` (pins the new id).
* Web Jest: `displayControl.test.ts` +1, `display-capabilities.test.ts`, `sleep-wake.test.ts`; i18n parity green.
* Playwright `emergency-path.spec.ts` chromium + webkit (page code changed: the kill-switch passthrough).

## Field candidate

Dispatch `Android Player APK` with `playerFieldCandidate = 1.1.52-field.1` (workflow_dispatch; no version
literal edited by hand, as 1.1.45–1.1.51). Not dispatched, registered, mirrored, tagged or released here.

## What to verify on a GUQ panel (the launch gate for this feature)

Have `adb logcat | grep -E 'VendorBacklight|DisplayControl|DisplayEmergency|NativeAlertWatch'` running
where possible, and the screen's Overview open. Record each row with date + initials.

1. **Detection.** After install and one process start, the Overview's native report shows
   `sleep.vb.d = "available"` and `sleep.blank = "vendor-backlight"`; the log shows `vendor backlight:
   available (probe 1)`. If `d` is `unreachable` or `unsupported`, STOP: the wire shape is wrong for this
   firmware (see "Wire shapes"); the chain has fallen through and behaves as 1.1.51.
2. **Sleep → dark.** Dashboard **Turn off**. Expected in < 2 s: the glass goes dark (backlight off, not a
   black picture — check with a torch at an angle, or the panel's power LED if it reflects backlight
   state), `displayApply` returns `provider: "vendor-backlight"`, and the sleep report shows
   `last.m = vendor-backlight`, `last.o = off` (the MCU's readback) and `vb.off = true`. Android stays
   interactive (`interactive: true` on the native report) and the heartbeat keeps arriving every minute.
3. **Alert while dark → lit in < 1 s.** With the panel dark, fire a device-scope DRILL lockdown. Expected:
   the backlight comes on in well under a second and the alert is on the glass; the log order is
   `vendor-backlight-on` step → window hooks → registry wake; `PLAYER_NATIVE_ALERT_RAISE` may also appear
   (the native watch was polling the dark panel — `the vendor backlight went off` kick in the log). Then
   repeat with the page killed (`adb shell am force-stop` is too much — instead block the page's host
   in DNS or pull Wi-Fi after the panel is dark, restore it, and fire the drill): the native watch alone
   must light the panel.
4. **All-clear → dark again.** Release the drill. Expected: the panel goes dark again within a few
   seconds (`RestoreBlankAfterAlertPolicy` → `RESTORE_BLANK`, `all-clear: the screen was blanked before the
   alert — putting it back to blank`), via `vendor-backlight`. Then: Turn on during a drill, release — the
   panel must STAY lit (`WAKE_COMMAND_DURING_ALERT`).
5. **Turn on.** Dashboard **Turn on** from dark: lit in < 2 s, `vb.off = false`, no black overlay left
   behind.
6. **Hard schedule.** With a 2-minute off/on window configured: the panel goes dark at the off edge and
   lit at the on edge through `vendor-backlight` (the schedule now routes HARD on this verdict — confirm
   the manifest's `display.schedules` carries the window and `softSchedules` is empty).
7. **Reboot behaviour.** (a) Dark, then pull mains for 30 s: the panel must come back LIT (vendor firmware
   restores the backlight; our record is void with the new boot count) and then, because the persisted
   blank is still in force, go dark again once the process restarts and re-applies the blank (
   `window attached while blanked — re-applying blank`). Decide whether that is the wanted behaviour for
   the fleet; it is the same as every other mechanism today. (b) Dark, process killed (`am crash` or an
   OTA): the process restarts, `isDarkByUs` is restored from prefs, and the panel stays dark with the
   watch polling.
8. **Vendor service missing → fallback.** On a unit where `com.seewo.mcuservice` is disabled (`pm
   disable-user --user 0 com.seewo.mcuservice` — RE-ENABLE afterwards), or on any non-GUQ box: `sleep.vb`
   absent (or `d = unreachable`), `sleep.blank` is the 1.1.51 mechanism, Turn off / Turn on behave exactly
   as before, no new log noise beyond one `vendor backlight: unreachable` line per retry.
9. **Kill switch.** Set `PLAYER_VENDOR_BACKLIGHT=-<this screen's uuid>` on the API while the panel is dark
   via vendor-backlight. Expected on the next manifest: the panel LIGHTS, then goes dark again through the
   next mechanism in the chain (or the black overlay), and `sleep.blank` no longer says
   `vendor-backlight`. Unset the env; the mechanism returns on the next manifest.
10. **Soak.** Leave the panel dark overnight on the schedule; in the morning the heartbeat has arrived
    every minute, the watch logs show polls every 15 s, and a drill still lights it. Then fill the
    `goodview-t982-a11` / `-a13` rows in `apps/player/HARDWARE-QUALIFICATION.md` with what was seen.

If step 3 ever shows the alert on the glass with the backlight still off — even once — the mechanism is
not launch-ready: remove `vendor-backlight` from `DISPLAY_POWER_PROVEN_MECHANISMS` and set the kill
switch while it is investigated.
