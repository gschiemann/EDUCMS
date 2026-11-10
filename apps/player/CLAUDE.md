**Scope:** this file governs `apps/player/` — the Android player APK; `/CLAUDE.md` and `/AGENTS.md` are the core it refines — where they disagree, the core wins. The text below moved here verbatim from the old single-file `CLAUDE.md` on 2026-11-01 (move map: `docs/governance/decisions/2026-11-01-rulebook-restructure-map.md`).

# APK rulebook

## Rule 9 — APKs ship tested or not at all (and the hardware qualification gate)

9. **APKs ship tested or not at all**: `android-player-apk.yml` runs `testDebugUnitTest` +
   `lintDebug` (baselined, blocking for anything new) before any assemble. Bridge methods are a
   three-file atomic contract (Kotlin `METHODS` + dispatch arm, web `NATIVE_VOID/VALUE_METHODS`,
   canary count in `nativeBridge.test.ts`) — and a NEW method must be excluded from
   `KNOWN_METHODS` until the fleet floor includes the APK that implements it, or manifest-less
   channel devices lose the call silently.

    **Hardware qualification gate (2026-09-02).** Green CI is a unit-test claim, never a
    fleet claim — headless Chromium does not reproduce OEM cert stores, OEM DNS, memory
    pressure, broken WebView providers, remote-key firmware or storage corruption (two
    units bricked at install; an Android-9 Goodview LCD sat on "Connecting…" with every
    check green). No release is production-ready until every REQUIRED hardware class in
    `apps/player/HARDWARE-QUALIFICATION.md` has PASS for cold install, pairing, reboot,
    offline recovery, content update, emergency drill, remote-only nav, OTA push and
    boot-proof. `scripts/check-hardware-qual.cjs` checks it before any assemble on a
    release TAG (`player-v*` — the unit; `manager-v*` tags are retired and refused) and inside `scripts/release-apk.sh` — and
    nowhere else: a field candidate (`workflow_dispatch` with `playerFieldCandidate`,
    delivered through `/super/field-builds`) skips the gate
    (`docs/governance/FIRST-RESPONSE.md`). Run
    `docs/player/HARDWARE-QUAL-CHECKLIST.md` on the glass. Never invent a PASS row —
    untested is `UNQUALIFIED`, and `--unqualified-override` is a logged hotfix debt.
    **State on 2026-11-01:** the matrix holds 0 `PASS` cells; the 16 player releases
    1.1.13–1.1.29 are 945 `OVERRIDE` cells, and player 1.1.12 and manager 1.0.24 are all
    `UNQUALIFIED` — so every player release from 1.1.13 on shipped on a recorded override,
    never on a PASS, and field candidates carry no matrix row at all.

## Rule 13 — player release

13. **Player release = a reviewed PR, then a tag on the merged commit**: branch
    `<vendor>/<topic>` → PR in the decision format → `gh pr checks <PR> --watch` →
    different-vendor review (a player release is consequential) → the Lead merges on the
    owner's written go → tag the MERGED commit `player-vX.Y.Z` and push the tag. No model
    pushes to `master` (`AGENTS.md` hard stop). The "APK version is tagged" check
    (`deploy-reliability.yml`) reads red on the version-bump PR until that tag exists; it is
    not a required check, so it does not block the merge — tag the merged commit and re-run
    it (a tag cut seconds after the push raced the same gate on v1.1.7 AND v1.1.8).
    `scripts/release-apk.sh` bumps `apps/player/versions.properties` and tags locally; push
    only the tag, after the merge.

    **One release unit (2026-11-08).** The Player APK and the companion Manager APK are
    one release: both versions live in `apps/player/versions.properties` (`unit.version`
    for the Player — the tag and the matrix section — and `manager.version` for the
    Manager, which moves only in a release that changes `apps/player/manager`; the gradle
    files hold no literal, `scripts/check-apk-versions.cjs` refuses one), one CI run
    builds both, the `player-v<unit>` release carries both APKs, and the Manager reaches a
    screen only inside the Player APK: the Player installs the bundled companion when its
    versionCode is newer than the installed one (`ManagerBootstrap`, `ManagerUpgradeMath`),
    so the Manager rides the Player's ladder — field window, tracked push, canary, one
    class, off-hours. The Manager never updates itself (`ManagerUpdatePolicy`;
    `/manager-update-check` answers `installVia: 'player'` unless
    `MANAGER_SELF_UPDATE_LEGACY_LANE=on`), and `manager-v*` tags are retired. A field
    candidate `x.y.z-field.N` renames the Manager too only when it changed in that line;
    the field-candidate registry records both digests.

## The companion Manager's alert-watch watchdog (2026-11-08, wave 5 — unmerged until a different-vendor review and the on-glass drill)

The native alert watch (1.1.22+) is the one thing that can raise an alert on a dark panel, and until this wave nothing outside the Player's process checked that it was running. Now the watch writes a STAMP into the Manager's health provider after every pass (`alertwatch/AlertWatchStamp.kt`: `elapsedRealtime`, watching / idle / not-watchable, faces, the Player's own dark verdict — vendor-dark counts —, hold held, and the server's mode), and the Manager's `AlertWatchWatchdog` judges it on its 30 s tick (`apps/player/manager/.../alertwatch/AlertWatchWatchdogPolicy.kt`, rules 1–7 in its header). **Add only:** its two actions can only START the watch — a signature-permission broadcast into `alertwatch/AlertWatchKickReceiver.kt` (`rearm`), then the same after `HeartbeatService.ensureRunning` (`restart-host`). Never the Activity (its manifest `turnScreenOn` would light a scheduled-dark panel), never the hold (a hold stands it down), never a reboot, and it defers while the Player heartbeat is stale (the liveness watchdog owns a dead process). Silence is counted in Manager ticks past a 2-minute stamp age, a tick gap of ≥ 90 s (a t982 deep standby) restarts the count, one ladder per 30 minutes and six interventions per 24 h, persisted. One stamp per PROCESS, so a double-sided DH43 gets one ladder (the echo class). Off unless the manifest's `display.alertWatchWatchdog` says `on` or `observe` (`MANAGER_ALERT_WATCH_WATCHDOG`, `docs/ENVIRONMENT.md`); every verdict rides the Player's signed heartbeat as `x-venueos-alert-watch-watchdog` into `nativeRuntimeReport.alertWatchWatchdog` and the screen drawer's Device card. Drill: `docs/player/ALERT-WATCH-WATCHDOG-DRILL.md`. Tests: `AlertWatchWatchdogPolicyTest` (every rung, the backoff, the 48-hour no-loop property, "never clears or suppresses"), the wiring tests on both sides, `AlertWatchStampTest`, `NativeAlertWatchStatusTest`.

## The hold release needs page proof on the every-frame bridge (2026-11-09 — unmerged until a different-vendor review and the on-glass drill)

On a device where the compat shim cannot attach, the bridge object is visible to every frame, so content inside a zone could call `displayEmergencyHold(false)` and release a live hold (standby, blank and brightness restored, every native reader of the hold un-gated), or forge `heartbeatV2` state (a healthy sync, a new paint-proof episode). The bridge now keeps a per-document **page-proof latch** (`WebAppBridge.pageAuthProven`): set by any message the origin-scoped channel accepts, or by the valid nonce on `displayEmergencyHoldAuth` / `heartbeatV2Auth` (legacy object only, never on the channel's `METHODS`); reset at every main-frame document event. While it is set, an un-authenticated RELEASE is refused (`{"ok":false,"code":"hold-release-unauthenticated"}` — the web retries it each manifest poll) and an un-authenticated `heartbeatV2` is a bare liveness tick. **A raise is never refused.** While it is not set the bridge behaves as before — the failure direction: a page that cannot authenticate (an old bundle, a nonce that never lands) still releases its own hold, so "pinned lit forever" cannot return; that is why a nonce on some OTHER gated method never sets the latch. The web calls the `*Auth` name only when it exists and a nonce was injected (`LEGACY_PAGE_AUTH_METHODS` in `apps/web/src/app/player/nativeBridge.ts`; both entries move together, a new name because the legacy bridge dispatches by name and arity). Residuals: the window between a document event and the page's next authenticated call; liveness `heartbeat()` stays forgeable. Tests: `HoldReleasePageProofTest`, the "page-authenticated hold and heartbeat" block in `nativeBridge.test.ts`. Not proven on a device.

## Process health — memory pressure, main-thread liveness, exit evidence (2026-11-09, unmerged)

Code: `app/.../health/` (`MemoryPressurePolicy`, `MainThreadStallPolicy`, `ExitEvidencePolicy`, `ProcessHealthReport` — pure, JVM-tested — and the glue `ProcessHealth`, installed from `PlayerApp.onCreate`). Rules:

- **Both liveness signals run off the main thread** — the native heartbeat (`HeartbeatService`, `Dispatchers.IO`) and the Manager heartbeat (`ManagerHeartbeatPublisher`, its own `HandlerThread`) — so neither proves the glass. Main-thread liveness is its own fact: a probe on `edu-main-probe` posts a no-op to the main looper every 5 s and measures it on `uptimeMillis` (stops in deep sleep). ≥ 10 s unanswered opens a stall (counted once, the main stack captured once, top 12 frames, redacted, ≤ 600 chars), 30 s asks for one prompt heartbeat; a probe that itself did not run for 15 s is `starved`, never a stall. **Observe and report only**: no reload, restart or kill (the Manager's relaunch is a `startActivity`, which cannot unfreeze a hung main thread, and a self-kill is unproven on the classes that cannot relaunch an Activity from the background). A restart rung needs the owner's decision and a bench proof first.
- **Memory pressure**: `TRIM_MEMORY_UI_HIDDEN` is not pressure. Every other level is recorded. Only `RUNNING_CRITICAL`, `COMPLETE` and `onLowMemory` free, and the free is the player WebView's RAM cache (`clearCache(false)`) — never the disk cache, the service worker, the media cache or the emergency tier, never a reload; at most once per 10 minutes; never while `DisplayEmergency.isHeld` is true or unreadable.
- **Exit evidence**: `ProcessExitDiagnostics` hands the kept `ApplicationExitInfo` records (API 30+) to `ProcessHealth.rememberExits`; the newest 4 ride every signed heartbeat. An ANR (main-thread section of the OS trace only, `LogRedaction`, ≤ 6 KiB) or a native crash is posted once to `POST /screens/status/:fp/crash-report` WITH the device credential (acknowledged on 2xx or a 4xx other than 429; at most 2 waiting). A JVM crash is not re-sent (`CrashUploader` sent it); a low-memory or OEM kill is summary only.
- **Wire**: header `x-venueos-process-health` (≤ 1536 chars, only on a request carrying the device credential to the pinned API host) → `nativeRuntimeReport.processHealth` (`apps/api/src/screens/process-health.ts`, strict, `.catch(undefined)`, telemetry only). Also carries the process RSS, `availMem` / `lowMemory` and the PowerManager thermal status (API 29+, absent below).
- **Kill switch** `PLAYER_PROCESS_HEALTH=off`: the server ignores the header and replies `processHealth: "off"`; the Player stops the probe, the free, the header and the trace posts (kept in prefs until told `on`). **Failure direction**: any fault leaves the player as it was before this code.

## Rule 15 — every operator-facing surface must be remote-operable

15. **Every operator-facing surface must be REMOTE-OPERABLE** (2026-08-30 — two new units
    bricked at install): most panels are wall-mounted with a D-pad remote as the ONLY input.
    Focus must be PARKED on a real control (a focusable root holding focus counts as
    UNPARKED — the SetupChecklistView bug), with a visible highlight (`applyRemoteFocus` —
    OEM ROMs strip the default), and Back must always reach an actionable escape, never a
    silent state toggle: every render branch that can be on glass must render the
    playbackStopped/escape surface (the `phase === 'connecting'` ternary arm beating
    `playbackStopped` is how a screen traps its installer). An escape keypress must never
    silently burn ceremony steps, and touch-only affordances (corner-hold) never count as
    the re-entry path.

## Native video, display and vendor-backlight behaviour

These descriptions used to sit inside rows of the environment table. The variables, tokens, defaults and kill switches stay in `docs/ENVIRONMENT.md`; the behaviour is here, once.

### Per-face native video engine (`PLAYER_NATIVE_VIDEO`)

One independent session per face, so a double-sided unit runs any combination (same file, different files, video + template).

Never for emergency, sync-locked, template, mixed, audio or canvas-override content; web `<video>` takes over on any native end (transient ends retry in 30 s, a native fault blocks that file on that face for 24 h). Native plays only a file whose size + SHA-256 it verified on disk, from its own authenticated manifest. Measure with `lastVideoReport.native` (`uniqueFrames` delta vs elapsed, `loops`, `codecName`).

### Native video experiments and the automatic pacing behaviours (`PLAYER_NATIVE_VIDEO_EXPERIMENTS`)

(1) the player WebView goes INVISIBLE while a solo native session presents (VISIBLE again on any end, FIRST on an emergency hold; a process-wide guard disables it after one fault — one flip, never a storm); (2) `Surface.setFrameRate(fps, ONLY_IF_SEAMLESS)` on API 30+; (3) the Activity stays in the panel's natural orientation (`setOrientation('NATURAL')`, no new bridge method) and the decoder rotates. **1.1.42 (2026-10-18, the pacing finding: M43 and L55VEC run 30 fps on a 30 Hz mode — zero headroom, two free-running clocks, a frame periodically straddles a vsync):** (4) `vsync-snap` — every decoder output is released at the vsync CLOSEST to its due time, on a period + phase the APK measures from `Choreographer` on the UI thread (`media/VsyncClock.kt`, bounded, allocation-free, Media3's `VideoFrameReleaseHelper` rule: 0.8 of a period early so SurfaceFlinger latches it for exactly that vsync), and the media clock is slewed by at most 0.3 ms per frame toward the grid so it stays locked instead of walking across half a period (`VideoFrameSchedule.releaseTime`); the late/drop policy and the emergency-first order are untouched; the snapshot gains `snappedFrames`, `snapErrorMaxUs`/`snapErrorMeanUs`, `clockSlewUs` (signed — the measured drift), `vsyncPeriodUs`, `vsyncSamples`; the fault guard covers it like (1). Only on the default display (a face on a second panel is not snapped). (5) `prefer-60hz` — when the panel lists a ~60 Hz (59–61) mode of the SAME resolution, the APK asks for it through `Window.preferredDisplayModeId` on the face's own window (the Activity's, or the face Presentation's) at a native session boundary, BEFORE that session's surface exists, never mid-session; kept for the process while the flag stays on, reverted at a session boundary once it is withdrawn; `preferredModeApplied` / `preferredModeResult` and the live `displayMode` say what happened. **⚠️ A display-mode switch can BLANK the panel for a second or two** — it ships default OFF and the lead switches it on per screen after proving it on the glass. Flag or not, every supported mode is logged once per native session (`PLAYER_NATIVE_VIDEO_DISPLAY … modes=…`) and rides the snapshot as `timing.supportedModes` and on `device.supportedModes` / `device.refreshRate`; `timing.keepScreenOn` reports whether the window held `FLAG_KEEP_SCREEN_ON` (read, never written, by the engine — `KeepScreenOnContractTest`). Needs an APK ≥ 1.1.42 for (4)/(5); older APKs ignore the keys. **1.1.43 (2026-10-19, owner: "make sure it auto detects, I don't want another setting"): (4) and (5) are AUTOMATIC — no setting, decided by the device from its own facts on every class that runs native (Taurus stays web-only, so nothing applies there).** (4) is ON for every solo session on the default display, with a GRID-SIZED release lead (`VideoFrameSchedule.releaseLeadNs`: 0.8 P on grids of ≥ 25 ms, 0.5 P on grids of ≤ 20 ms — 8.3 ms before each vsync at 60 Hz — linear between; the fixed 0.8 P latched ~0.17 % of frames one vsync EARLY on the rk3328 unit's 60 Hz grid), reported as `releaseLeadUs` on the snapshot and the ledger. (5) is asked ONCE per process, on the default display's face only (face 0 — the safety net's frame proof follows that display; a double-sided unit's second panel never switches), at the first native session boundary after boot (before that session's surface exists, while the web engine still shows the content; never for a slot; never under an emergency hold — neither the request nor the kill switch's withdraw, which is a mode switch too) and then PROVEN by a safety net: within 10 s the active mode must be the one asked for (else `reverted-no-switch`) and Choreographer frames must still flow (one within 2 s of the check, else `reverted-no-frames`), and the first native frame confirms it; a stall (`output-stalled` / `output-unavailable` / `codec-stalled`) before that first frame is the switch's failure — the session ends TRANSIENT as `display-mode-reverted`, never a 24 h block of the file. A failed switch is reverted to mode 0 and the request is blocked on the unit for 24 h (persisted in the `native_video_display` prefs, so it survives the nightly reboot; `blocked` while it stands; once per process, a later boundary repeats the verdict).

Same build: failure grading phase 0 — `NativeEndGrade` (`FaceVideoPolicy.kt`), mirrored by `nativeVideoEndGrade` (`nativeSharedVideo.ts`; a web test reads the Kotlin and fails on drift): TRANSIENT and NOT-READY ends (network, storage, authorization, manifest — an offline boot, a 5xx, `media-incomplete` for a short download, `media-missing` for a pruned cache file) are retried and never block; BOX verdicts stay web for the document; only a FAULT of a verified file blocks for 24 h, and an ungraded code fails closed as a fault. And the panel FIRMWARE's own display facts, read-only and bounded: `device.sysDisplayMode` (Amlogic `/sys/class/display/mode`, ≤ 48 chars) and `device.sysDisplayCaps` (Amlogic `disp_cap`, else Rockchip `fb0/modes`; ≤ 16 × ≤ 32), stripped to `[A-Za-z0-9:_.*+/@-]`, re-read at most every 30 s, shown on the Overview for the default display's face only. Needs an APK ≥ 1.1.43; nothing hardware-qualified yet.

### Vendor backlight — true standby on a Goodview GUQ (`PLAYER_VENDOR_BACKLIGHT`)

On an Amlogic t982 / IFPDOS panel the player's BLANK now binds the panel vendor's own control service (`com.seewo.mcuservice`, action `com.ifpdos.opensdk.SERVICE_MANAGER` — the call the vendor's own player makes) and asks the MCU to switch the **backlight** off (`CmdSetScreenStatus(false)`) while Android, the app, its WebView and the native alert watch keep running; WAKE and every alert switch it back on through the same call. New blank mechanism `vendor-backlight` (`apps/player/.../display/VendorBacklightProvider.kt`, rules in `VendorBacklightPolicy.kt`), between an explicit vendor recipe and the device-admin lock in the BLANK/WAKE chains. **Auto-detected, no setting**: offered only once the service is installed, binds, hands out a token and answers a probe on that box (bounded, off the main thread; a box that proved it once is trusted through the next boot's probe); every other box resolves exactly as before. **Emergency first**: `DisplayEmergency.enforceNow` queues the backlight ON on the provider's worker before its first window hook and never waits for it; the native alert watch treats a vendor-dark panel as dark (`isDarkByUs`) and polls; the all-clear restores the pre-alert state exactly as 1.1.51 (the mechanism is not in `RestoreBlankPolicy.LOCK_FAMILY`). A failed ON after our own OFF latches a per-process fault that withdraws BLANK (never WAKE); a failed vendor blank never falls through to a latch-prone lock below Android 13. Server side `vendor-backlight` joined `DISPLAY_BLANK_MECHANISMS` and `DISPLAY_POWER_PROVEN_MECHANISMS` (same class as a recipe: reversed by the same command, Android awake, no vendor standby entered), so the dashboard's Turn off and the hard on/off schedule reach it; removing that one entry routes the GUQ class soft again. The sleep report carries `sleep.vb` (`d` detection, `off`, `f` fault) and `sleep.blank`/`last.m` name the mechanism; a vendor blank proves `off`/`on` only by the MCU's own readback.

Needs an APK ≥ 1.1.52; nothing hardware-qualified yet — the on-glass checklist is in the design doc.

## Legacy-engine compatibility layer (old system WebViews)

A frozen-firmware panel keeps its system WebView (Goodview GUQ, Android 11: WebView 95), and modern single-page sites call JavaScript builtins that engine lacks (a Metabase 0.64 dashboard failed its login on it). When the WebView major is below `LegacyEnginePolicy.MODERN_WEBVIEW_MAJOR` (120) and `DOCUMENT_START_SCRIPT` is supported, `webcompat/LegacyEngineCompat.kt` registers `assets/legacy-engine-polyfills.js` (pure ES5, feature-detected, one try/catch per feature) with `addDocumentStartJavaScript(…, setOf("*"))` on the player WebView, the website / Website Tabs overlay and each face — and again on the fresh WebView after a renderer death, because the same configure runs. Document-start scripts are not subject to the page's CSP. The player's own origin is skipped inside the script, so the player bundle and the emergency path run on the unmodified engine; the layer has no native surface (no bridge, listener or interface — `LegacyEnginePolicyTest`, `WebTabsWiringTest`). Proof on the glass: one durable `PLAYER_LEGACY_POLYFILL installed webview=<major> features=<N> view=<player|overlay|face-N>` line per WebView. A modern engine, an unreadable version or a WebView without document-start support loads nothing. Syntax (regex `v` flag, decorators, `using`) cannot be polyfilled. Tests: `apps/web/src/app/player/__tests__/legacyEnginePolyfills.test.ts` (Jest, per-feature spec checks + "a modern engine is unchanged") and `apps/web/tests/e2e/legacy-engine-polyfills.spec.ts` (an engine-95 login page with a strict CSP, chromium + webkit).
