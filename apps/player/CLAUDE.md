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
    release TAG (`player-v*` / `manager-v*`) and inside `scripts/release-apk.sh` — and
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
    `scripts/release-apk.sh` bumps the gradle and tags locally; the
    `git push origin master <tag>` hint it prints predates this rule — do not follow it.

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
