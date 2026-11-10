# 01 — Player process health (build agent A, 2026-11-09)

**Branch:** `claude/player-process-health` (cut from `origin/master` 58ec24c2). Not pushed. **Model:** Claude Opus 5.5, Claude Code (agent worktree).
**Scope:** inventory gaps 1 (memory pressure), 4 (frozen app), 8 (native crash / ANR upload), and the cheap part of "thermal / hardware health".

## What already existed (verified in the code)

- **No memory-pressure handling** — confirmed: `grep -rn -E 'onTrimMemory|onLowMemory|ComponentCallbacks2' apps/player --include='*.kt'` returned zero hits before this branch.
- **A frozen main thread was invisible to both liveness signals.** The native server heartbeat is a coroutine on `Dispatchers.IO` (`HeartbeatService.runLoop` / `tickWithWakeLock`); the Manager heartbeat owns its own `HandlerThread` (`ManagerHeartbeatPublisher`, moved off the main looper by C-P2-15). So a frozen glass kept reporting ONLINE to the server and "alive" to the Manager. The Manager's recovery (`WatchdogService.forceRestartPlayer`) is a `startActivity` of the launch intent — it cannot unfreeze a hung main thread (the intent queues on that very thread), and the 15-minute `WatchdogReceiver` runs on the main thread too. `MainActivity`'s content/staleness watchdogs are main-thread tickers, frozen with it.
- **Exit evidence never left the box on its own.** `ProcessExitDiagnostics` / `BootReasonDiagnostics` wrote `PLAYER_PROCESS_EXIT` / `PLAYER_BOOT_REASON` lines into the on-device log only (reached the server only through an operator's "Get recent logs"). `CrashUploader` posts JVM crashes anonymously to `POST /screens/status/:fp/crash-report`; its header comment says ANR and native crashes are not covered.
- **Thermal:** nothing read `PowerManager` thermal status.

## What I built

1. **Memory pressure** — `health/MemoryPressurePolicy.kt` (pure). `UI_HIDDEN` ignored (it fires every time a panel goes dark); every other level recorded (count, max, last, time); only `RUNNING_CRITICAL`, `COMPLETE`, `onLowMemory` free memory, and the free is the player WebView's RAM cache (`clearCache(false)`, the same call the bridge reload already uses) — never disk, service worker, media cache, emergency tier, never a reload; once per 10 min max; never while `DisplayEmergency.isHeld` is true or unreadable. Registered Application-wide (`ProcessHealth.install`); the free is a hook MainActivity sets (`freeRamCache`, reads the current WebView so a renderer replacement is followed).
2. **Main-thread probe** — `health/MainThreadStallPolicy.kt` (pure) + `ProcessHealth` glue: background `HandlerThread` `edu-main-probe` posts a no-op to the main looper every 5 s, measured on `uptimeMillis` (stops in deep sleep, so a t982 standby is never a stall). ≥ 10 s opens a stall (counted once, main stack captured once — 12 frames, redacted, ≤ 600 chars, `PLAYER_MAIN_STALL start/end` log lines), ≥ 30 s requests one prompt native heartbeat so the server learns while it is frozen; a probe that itself did not run for 15 s is `starved`, never a stall. **Observe and report only — no self-restart.** Reason: the only restart paths are a self-kill plus a background Activity relaunch, which is BAL-blocked on Android 10+ without "display over other apps" / device owner (ruled out), so on several classes it would trade a frozen frame for the OEM launcher; I could not prove it on hardware. I did not feed the Manager watchdog (withholding the Manager heartbeat would make it `startActivity` — useless on a hung thread and, once the stall clears, a playback-interrupting relaunch, exactly what `Watchdog.kt` warns about).
3. **Exit evidence** — `health/ExitEvidencePolicy.kt` (pure): the newest 4 kept exits ride every signed heartbeat; an ANR (main-thread section of the OS trace only, `LogRedaction`, ≤ 6 KiB) or a native crash is posted once to the existing crash-report route **with the device credential** (so `lastCrashAuthenticated = true`, shown by the dashboard's existing `lastCrash*` line). JVM crashes are not re-sent; low-memory / OEM kills are summary only. ≤ 2 waiting, acknowledged by value on 2xx or 4xx≠429, posted on a background thread after a successful signed heartbeat.
4. **Thermal + memory facts** — PowerManager thermal status (API 29+, absent below), process RSS (`/proc/self/statm`), `availMem` / `lowMemory`.
5. **Wire / API** — header `x-venueos-process-health` (≤ 1536 chars, only with the device credential to the pinned host) → `nativeRuntimeReport.processHealth` (`apps/api/src/screens/process-health.ts`, strict zod, `.catch(undefined)`, telemetry only; no schema change — `nativeRuntimeReport` is already a telemetry-only JSON column).

## Kill switch and failure direction

`PLAYER_PROCESS_HEALTH` (env-schema, generated docs refreshed): exactly `off` → the API ignores the header and replies `processHealth: "off"`; the Player persists it and stops the probe's posts, the memory free, the header and the trace posts until told `on`. Unset = on. Failure direction: open — any fault in this code is caught and leaves the player exactly as before; an unreadable emergency state blocks the free.

## Files changed

- New: `apps/player/app/src/main/java/com/educms/player/health/{MemoryPressurePolicy,MainThreadStallPolicy,ExitEvidencePolicy,ProcessHealthReport,ProcessHealth}.kt`; tests `apps/player/app/src/test/java/com/educms/player/health/{MemoryPressurePolicy,MainThreadStallPolicy,ExitEvidencePolicy,ProcessHealthReport,ProcessHealthWiring}Test.kt`; `apps/api/src/screens/process-health.ts` + `.spec.ts`.
- Edited (small): `PlayerApp.kt` (+5), `ProcessExitDiagnostics.kt` (+7), `heartbeat/HeartbeatService.kt` (+16), `MainActivity.kt` (+15), `apps/api/src/screens/native-runtime.ts`, `screens.controller.ts` (+12), `apps/api/src/config/env-schema.ts`, `docs/ENVIRONMENT.md` + `.env.example` (generated), `apps/player/CLAUDE.md`, `CHANGELOG.md`.
- Manager: untouched.

## Tests run

- `:app:testDebugUnitTest` — 1681 tests, 0 failures, 2 skipped (pre-existing); the 31 new health tests pass (7 + 9 + 7 + 3 + 5). `:app:lintDebug` — pass.
- API: `npx jest src/screens` — 87 suites, 1225 tests, all pass (includes the new `process-health.spec.ts`); `npx jest src/config` — 28 pass; `tsc --noEmit -p tsconfig.build.json` — clean (`tsconfig.json` shows pre-existing errors in unrelated spec files only, none in files I touched).
- `node apps/api/tools/generate-env-docs.cjs --check`, `check-env-declared.cjs`, `node scripts/check-rulebook.cjs` — pass.

## NOT proven on hardware — what a bench test must check

Classes: rk3288 (DH43 / Taurus-class slow box), Goodview GUQ t982 (Android 11, WebView 95), one Android 13/14 panel, one API < 30 box (ApplicationExitInfo absent, thermal absent).
1. **Probe false positives:** run a normal day (boot, pairing, content changes, a native video session, panel off/on, t982 deep standby). Expect `main.n = 0` in `nativeRuntimeReport.processHealth`; a boot stall of > 10 s on rk3288 is a finding about the threshold.
2. **Real freeze:** a debug build that blocks the main thread for 45 s (e.g. `Thread.sleep` behind a debug intent). Expect `PLAYER_MAIN_STALL start` with a stack naming the sleep, a prompt heartbeat within ~35 s whose `main.openMs` ≥ 30000, then `end durationMs≈45000`. Confirm the native heartbeat kept flowing during the freeze.
3. **Memory pressure:** `adb shell am send-trim-memory <pkg> RUNNING_CRITICAL` (and `COMPLETE`) while a slideshow and, separately, a video play. Expect one `PLAYER_MEMORY_PRESSURE ... action=record_and_free` + "freed the player WebView RAM cache", **no visible change on the glass**, `mem.frees = 1`; a second send within 10 min records only. Repeat during an emergency DRILL: expect `action=record`, no free.
4. **ANR upload (API 30+):** force an ANR in a debug build, let the box recover, check the dashboard's crash line reads "ANR (previous process…)" with an authenticated `lastCrash*` and a main-thread-only, redacted stack; `exits` in the report carries reason 6.
5. **Thermal:** on an API 29+ panel, `th` present (normally 0); absent on older.
6. **Kill switch:** `PLAYER_PROCESS_HEALTH=off` on a staging API → the header disappears from the next heartbeats and no trim free happens; unset → back.

## Overlap with #294 / #295

`MainActivity.kt` (#294 touches it): two small additive blocks (after `webView = binding.webview`, and a field + three lines at the top of `onDestroy`); no shared lines with the bridge/emergency-hold code I know of — expect at most a trivial rebase. No overlap with #295.

## Open decisions for the owner

1. **A restart rung for a frozen main thread** (e.g. self-kill after ≥ 2 min frozen, never under an OTA install, once per hour, with the 15-min alarm and the Manager bringing it back): only after a bench proof per class that the Activity really comes back. Today: observe only.
2. **Ledger + alerts:** the server stores the facts but nothing shows or alerts on them yet (screen drawer Device card, interruption-ledger rows for ANR / low-memory exits, a customer alert) — UI and ledger were out of my scope.
3. The ANR post marks `lastCrash*` with the CURRENT version name (the OS does not record which version died); the message says "previous process".
