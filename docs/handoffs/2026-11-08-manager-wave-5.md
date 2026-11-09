# 2026-11-08 — Manager wave 5: the alert-watch watchdog

Written by Claude Fable 5.1 (Claude Code, worktree agent) for the Lead. Branch
`fable/alert-watch-watchdog`, cut from `origin/fable/manager-unified-release`
(PR #270, still open at the time of writing — no rebase onto master was needed).
Item #3 of `docs/handoffs/2026-11-08-manager-deep-dive.md` §5. Repository is
public: no customer names, no secrets.

**This does NOT merge until a different-vendor review has read the files
below and the on-glass drill (`docs/player/ALERT-WATCH-WATCHDOG-DRILL.md`) has
passed. Life safety, CHANGE class.**

## Situation

The native alert watch (Player 1.1.22+) is the only thing that can raise an
alert on a dark panel. It is kept alive from inside the Player's own process
(the heartbeat loop's minute kick, the 15-minute alarm). Nothing outside that
process checked it was running. The companion Manager already ticks every 30 s
beside the Player and reads its liveness heartbeat; it now also learns whether
the WATCH is alive, and can bring it back — without lighting the panel, without
touching the hold, without looping.

## What was built (file → why)

### Manager (`apps/player/manager`)

| File | Why |
|---|---|
| `src/main/java/com/educms/manager/alertwatch/AlertWatchWatchdogPolicy.kt` | The rules, pure: tick → (memory, action, record). Rules 1–7 in the header: add only; the panel stays dark; unset means today; silence counted in ticks (a ≥ 90 s tick gap = the box slept, streak restarts); one bounded ladder (re-arm → restart host → UNRECOVERED), one per 30 min, six interventions per 24 h; one device one ladder; every verdict a fact. `Action` has only `NONE / REARM / RESTART_HOST`. Memory encode/decode (flat `k=v`), no `org.json`. |
| `…/alertwatch/AlertWatchStore.kt` | Prefs-backed stamp (Player → Manager), record (Manager → Player) and memory. Column names = the wire contract with the Player's `AlertWatchStamp.kt`. |
| `…/alertwatch/AlertWatchWatchdog.kt` | The Android half: clock, `PowerManager.isInteractive`, the heartbeat age from the provider's prefs, the ONE broadcast (`com.educms.player.ALERT_WATCH_KICK`, explicit component, sent with `HEALTH_PERMISSION`). Never `startActivity`, never a launch intent, never the hold, posts nothing to the server. |
| `…/PlayerHealthProvider.kt` | Additive URI paths `alert-watch` (Player inserts the stamp) and `alert-watch-watchdog` (Player reads the record). Same signature permission as the heartbeat. |
| `…/WatchdogService.kt` | One additive hook in the tick, after and isolated from the liveness check. |
| `src/main/AndroidManifest.xml` | `<uses-permission com.educms.manager.HEALTH_PERMISSION>` — the Player's receiver requires the sender to hold it. |
| `src/test/…/alertwatch/AlertWatchWatchdogPolicyTest.kt` | 31 tests: every rung, the waits, backoff, the cap, the 48-hour no-loop property with a flickering panel, Manager-restart round-trip, "never clears or suppresses" (action set + hold stands down), DH43 one ladder, the stand-down verdicts. |
| `src/test/…/alertwatch/AlertWatchWatchdogWiringTest.kt` | Source facts: no Activity launch / reboot / hold reach / HTTP in the Android half; one `sendBroadcast` with the permission; the manifest holds the permission; the service hook is after and apart from the liveness tick; the provider's two paths. |

### Player (`apps/player/app`)

| File | Why |
|---|---|
| `…/alertwatch/AlertWatchStamp.kt` (new) | Builds and publishes the stamp (rate-limited: on change or every 10 s), reads the Manager's record and renders the heartbeat header `x-venueos-alert-watch-watchdog` (hand-built JSON, ≤ 1024 chars, printable ASCII). Observability only. |
| `…/alertwatch/AlertWatchKickReceiver.kt` (new) | `rearm` → `NativeAlertWatch.ensureStarted`; `restart-host` → `HeartbeatService.ensureRunning` then the same. Never the Activity, never the hold. |
| `…/alertwatch/NativeAlertWatchEngine.kt` | Additive read-only `status` / `statusReason` / `watchedFaces`, set where the pass already decides. No decision changed. |
| `…/alertwatch/NativeAlertWatch.kt` | `stamp(app, machine)` after every `pass()`, using the SAME ports the pass used (power, hold). Still exactly one write to the interlock. |
| `…/display/DisplayConfig.kt` | `alertWatchWatchdogMode` from `display.alertWatchWatchdog` (`"on"` / `"observe"` exactly; else null). |
| `…/heartbeat/HeartbeatService.kt` | Four additive lines: the header, credential-gated, in its own `runCatching`. |
| `src/main/AndroidManifest.xml` | The receiver: exported, `android:permission=HEALTH_PERMISSION`. |
| Tests | `AlertWatchStampTest` (9), `AlertWatchWatchdogWiringTest` (6, incl. the Player/Manager contract agreement), `NativeAlertWatchStatusTest` (5), `display/DisplayConfigAlertWatchModeTest` (4). |
| `apps/player/CLAUDE.md` | One section describing the mechanism, with the drill pointer. |

### API (`apps/api`)

| File | Why |
|---|---|
| `src/display/alert-watch-watchdog-flag.ts` (+ spec, 6) | `MANAGER_ALERT_WATCH_WATCHDOG`: `on:<uuid|all>`, `observe:<uuid|all>`; unset = today; `on` wins; a typo enables nothing; a key only for a named screen. |
| `src/display/display-manifest.ts` | One line: `block.alertWatchWatchdog = mode` when named. |
| `src/screens/alert-watch-watchdog.ts` (+ spec, 5) | The header: strict zod, verdict/rung enums, ≤ 1024 chars. |
| `src/screens/native-runtime.ts` | `alertWatchWatchdog: …optional().catch(undefined)` inside the existing telemetry-only `nativeRuntimeReport` — no new column, no migration, a malformed block never drops the power report. |
| `src/screens/screens.controller.ts` | Five additive lines after the native-presenting block, same credential gate. |
| `src/config/env-schema.ts` | The declaration (kill switch, failure direction `closed`). |
| `docs/ENVIRONMENT.md`, `.env.example` | Hand-kept row (after `MANAGER_SELF_UPDATE_LEGACY_LANE`) + regenerated section (257 variables, 55 kill switches). |
| `packages/api-types/src/display-control.ts` | `DisplayManifestBlock.alertWatchWatchdog?: 'on' \| 'observe'`. |

### Web (`apps/web`)

| File | Why |
|---|---|
| `src/components/screens/v3/screenOps.ts` | `alertWatchWatchdogFact` (pure) and its row in `deriveDeviceFacts` after "Player app". `DeviceFact` gains `labelMsg` / `valueMsg` / `hintMsg`. Copy states what the device reported; warn tone for interventions and unrecovered; observe mode always said. |
| `src/components/screens/v3/ScreenDetailDrawer.tsx` | The Device card renders the translated form when present (`text(en, msg)`). Reachability: `ScreenDetailDrawer` is mounted by `ScreenOperationsV3` under the `/[tenant]/screens` route (the existing e2e `screen-drawer-end-user.spec.ts` opens it at `?screen=<id>`), and the new e2e opens the same drawer. |
| `src/i18n/messages/{en,es,zh}.json` | 17 keys under `screens.drawer` (`alertWatchLabel`, `alertWatchVerdict.*`, three hints). Parity: 7334 keys agree. |
| `src/components/screens/v3/__tests__/screenOps.test.ts` | 6 new tests (182 total in the file). |
| `tests/e2e/alert-watch-watchdog-drawer.spec.ts` | WebKit, 390×844 and 1325×758, the re-arm fact under Technical details; healthy + observe; screenshots. |

## Design decisions the reviewer should challenge

1. **Rung 2 restarts the watch's HOST, not the Activity.** `MainActivity` has
   `android:turnScreenOn="true"` and the standby code disarms it only during a
   person's standby; a schedule-dark panel would light up. A dead Player
   PROCESS is a stale heartbeat and stays the existing liveness watchdog's job
   (`WatchdogService.forceRestartPlayer`, untouched).
2. **The stamp uses `elapsedRealtime`** (shared kernel clock, NTP-immune),
   not wall time. After a reboot the stored stamp can read "future" → age 0 →
   fresh → nothing happens until the Player (seconds later) writes a new one.
   Fail direction: do nothing.
3. **The mode travels Player → Manager inside the stamp.** The Manager has no
   manifest; unset/`off` = no stamp mode = the Manager does nothing and clears
   its record, so the dashboard shows no row (today).
4. **No new DB column.** The verdict lives inside `nativeRuntimeReport`
   (already `SCREEN_TELEMETRY_ONLY_FIELDS`) with `.catch(undefined)`.
5. **A fresh IDLE stamp behind a dark panel counts as silence** — a loop that
   has not re-read the power state; the ladder's first rung is a kick that
   makes it re-read. A fresh NOT_WATCHABLE stamp (not paired / no API root) is
   reported and never kicked: a re-arm cannot pair a screen.
6. **Cross-package `startForegroundService` on API 31+** from a receiver the
   Manager's broadcast started: may be refused by the OS. That is rung 2's
   uncertainty; a refusal is caught, bounded, and ends as UNRECOVERED — the
   honest fact. The drill measures it per class.

## Validation (run in this worktree)

| Command | Result |
|---|---|
| `cd apps/player && ./gradlew :app:testDebugUnitTest :manager:testDebugUnitTest :app:lintDebug` (JDK 17) | app 1613 tests, 0 failures, 2 pre-existing skips; manager 48 tests, 0 failures; lint 0 errors |
| `cd apps/api && npx jest src/display/alert-watch-watchdog-flag.spec.ts src/screens/alert-watch-watchdog.spec.ts src/display/display-manifest.spec.ts src/display/display-manifest-branches.spec.ts` | 4 suites, 101 tests passed |
| `cd apps/api && npx jest src/emergency src/screens/alert-watch-watchdog.spec.ts src/screens/native-runtime` | 25 suites, 420 tests passed |
| `cd apps/api && pnpm run build` | exit 0 |
| `node apps/api/tools/generate-env-docs.cjs --check` | ok (both targets match) |
| `node apps/api/tools/check-env-declared.cjs` | **3 pre-existing errors, none mine**: `MANAGER_SELF_UPDATE_LEGACY_LANE` (PR #270 base) and `USB_EXPORT_FOLDER_NAME` are read but undeclared; `env-schema.spec.ts` fails on the same two. The lead's #270 train will hit this in CI. |
| `node apps/api/tools/check-tenant-isolation.cjs` | OK, 0 unscoped |
| `node scripts/check-rulebook.cjs` | PASS |
| `cd apps/web && npx tsc --noEmit -p .` | 0 errors |
| `cd apps/web && npx jest src/components/screens/v3/__tests__/screenOps.test.ts` | 182 passed |
| `cd apps/web && npx jest src/app/player` | 122 suites, 1779 tests passed |
| `node apps/web/tools/check-i18n-parity.cjs` | OK, 7334 keys |
| `pnpm --filter @cms/api-types build` | exit 0 |
| WebKit screenshots (`tests/e2e/alert-watch-watchdog-drawer.spec.ts`, `--project=webkit`, `E2E_REBUILD=1`) | see "Screenshots" |

**Not run here:** the emergency e2e (`apps/web/tests/e2e/emergency-path.spec.ts`)
needs the live signer chain and cannot run in this worktree; nothing in this
wave changes the emergency route, the WS gate, the manifest's `emergency`
field or `emergencyInterlock.ts` — the API emergency Jest suites and the
player's `applyManifest` tests above are the proof of "untouched".

## Screenshots

`docs/research/2026-11-08-manager-waves/wave-5/device-card-rearm-iphone.png`
(390×844) and `…/device-card-rearm-safari-1325.png` (1325×758) — gitignored
path, on the lead's machine only. WebKit, prebuilt bundle:
`tests/e2e/alert-watch-watchdog-drawer.spec.ts` 3 passed (two viewports with
the re-arm fact in amber under Technical details → Device, plus healthy +
observe mode). Both screenshots were opened and read: the "Alert watch" row
sits after "Player app", amber, with the hint "rearm 1 minute ago · 1
intervention in 24 h"; nothing else on the card or the Overview moved.

## What could NOT be verified (hardware)

Nothing here ran on a panel. Unproven until the drill:

- that the Player's stamp insert reaches the Manager's provider on every class
  (same permission path as the heartbeat, which does);
- that the Manager's explicit broadcast is delivered to the Player's
  manifest receiver on each OEM ROM (FUH43 drops receivers; `FLAG_INCLUDE_STOPPED_PACKAGES` set);
- that rung 2's `startForegroundService` is allowed on API 33 (M43/L55VEC)
  from a receiver started by another package's broadcast;
- that a GUQ55 in vendor-backlight standby reads `panel_dark=true` while the
  Manager's `isInteractive` says true (the policy handles it; the stamp field
  comes from the SAME `panelInteractive()` the watch already uses);
- that a t982 deep standby produces the ≥ 90 s tick gap the policy expects
  (if deep standby instead kills the Manager, `START_STICKY` + the persisted
  memory still bound the ladder).

## Rollback

Revert the five commits, or leave the code and keep `MANAGER_ALERT_WATCH_WATCHDOG`
unset: no stamp mode → the Manager does nothing and clears its record; the
Player's stamp writes are one binder call per 10 s while the watch passes,
and the heartbeat header is omitted. The existing watch is untouched by the
flag either way.

## Decision needed

(a) a different-vendor review of the two `alertwatch/` packages and the
receiver; (b) the first unified field candidate carrying this to ONE bench
screen per class, `observe` first; (c) the drill, with the timing table filled
in, before `on` for any screen. Nothing is tagged, pushed or armed by this wave.
