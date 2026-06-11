# 14 — Dedicated Player Audit (web /player + Android APK)

**Auditor:** Frontier deep-pass (Fable 5). **Date:** 2026-06-10.
**Scope:** Web player route (`apps/web/src/app/player/`, `apps/web/public/sw-player.js`, `apps/web/src/components/player/`), Android Player APK + Manager APK (`apps/player/`), pairing UX, manifest poll/backoff, render loop, emergency overlay precedence, offline behavior, stale-bundle recovery, orientation lock, multi-panel LED canvas, OTA chain, watchdog, kiosk pinning, D-pad nav, device-token auth.
**Method:** Traced real execution paths in code + curled live `https://venue-os.app/pair` and `/api/v1/health`. Dedup'd against the 2026-06-09 full-audit REPORT.md (its player coverage is thin — mostly reliability one-liners) and the 06-08 launch-readiness synthesis.

**Verdict on the core question — "survives a week unattended in a school hallway?": YES, with high confidence.** This is the most defensively-engineered surface in the product. The player has belt-and-suspenders recovery at four layers (web recovery loop → SafePlayerWebViewClient → native 10-min watchdog → cross-process Manager watchdog with rollback), a self-correcting 500ms slide interval that survives WebView throttling, full-jitter backoff on every retry path, and an emergency tier with a never-evicted 1 GB cache floor + power-cycle ride-through. The OTA versionCode-monotonicity lesson (1.0.66) is correctly fixed (`latestVc <= currentVc` guard). The single biggest *latent* gap is that the watchdog liveness signal does not prove the WebView is actually painting content — a frozen-but-alive WebView (page JS ticking, compositor stalled) would not trip the local watchdog. This is mitigated server-side by render-proof but not locally. No P0s found.

---

## Coverage table (Standard Audit Surface lenses)

| Surface | Coverage | DESIGN | UX | FUNCTIONALITY | Note |
|---|---|---|---|---|---|
| Pairing UX (QR + manual) | covered | A | A | A | Live page 200, jsQR scan + manual fallback, accepts 4-12 char codes |
| Manifest poll cadence/backoff | covered | — | A | A | 3s base poll, full-jitter backoff after 3 fails, adaptive 5/10s emergency |
| Render loop (transitions/video/PDF/iframe) | covered | A | A | A- | Self-correcting 500ms interval; daypart filter; per-widget error boundary |
| EXTERNAL_HTML sandbox + edit-shim arming | covered | A | A | A | `sandbox="allow-scripts"` null-origin; edit-mode NEVER posted on player (verified) |
| Emergency overlay precedence | covered | A | A | A | z-[9999], full-screen scene, manifest is sole arbiter, URL-overlay suppressed |
| Offline mid-playlist | covered | A | A | A | SW serves cached 200s, 1 GB emergency floor never evicted |
| Stale-bundle self-recovery | covered | — | A | A | 5-min build-info SHA compare → idle soft-reload w/ 60-300s fleet spread |
| Orientation lock | covered | A | A | A | LANDSCAPE/PORTRAIT/AUTO, persists in SharedPreferences pre-manifest |
| Multi-panel LED canvas | covered | A | A | B+ | 1-6 panel daisy-chain, auto-fit floor clamp; manifest-driven w/h |
| APK WebView config | covered | — | — | A- | JS/DOM on, file/content access OFF, mixed-content NEVER on main WV |
| OTA chain (versionCode monotonicity) | covered | — | A | A | `latestVc <= currentVc` guard; grace-window rollback; release-apk.sh |
| Crash watchdog (renderer + process) | covered | — | A | A- | onRenderProcessGone handled, native 10-min, Manager 90s×3 cross-proc |
| Kiosk pinning | covered | — | B+ | B+ | Opt-in via Device Owner (intentionally not auto — sideload trap fixed) |
| D-pad nav (task #9) | covered | — | B | B | KNOWN-OPEN: applyRemoteFocus on dialogs; spatial-nav shim for URL overlay |
| Device-token auth | covered | — | — | A | Bearer on manifest/emergency/render-proof; plain localStorage (H6, accepted) |

---

## VERIFIED SOLID (do not re-spend effort)

1. **Edit-shim NEVER arms on the player (the documented invariant holds).** `grep -rln "educms-edit-mode"` returns ONLY `PropertiesPanel.tsx` (the builder). The player page and `WidgetRenderer` have zero occurrences. The only postMessage from the live render path is `educms-overrides` (menu data) at `WidgetRenderer.tsx:2863`. A sandboxed null-origin board on a kiosk can never receive the hover-outline/click-report arming message. **This is the single most important player-safety claim and it is true.**

2. **EXTERNAL_HTML containment is real.** `WidgetRenderer.tsx:2900` ships `sandbox="allow-scripts"` (NO `allow-same-origin`) → null origin, no parent/cookie/storage access. A broken board is fully contained. The player's playlist-item iframe path for `text/html` assets routes through the SSRF-guarded `/api/v1/proxy/web` which strips `<script>` server-side (`page.tsx:6027`).

3. **OTA versionCode monotonicity — the 1.0.66 lesson is fixed.** `OtaWorker.kt:112-113`: `val latestVc = latest.optInt("versionCode"); if (latestVc <= currentVc) { ...skip }`. A re-published-without-bump APK cannot loop-install. `build.gradle.kts:66` is at `versionCode = 10074 / 1.0.74` and the latest tag is `player-v1.0.74` — tag and gradle are in sync (the exact thing that broke in the 1.0.66 incident). `scripts/release-apk.sh` exists as the scripted procedure.

4. **Manifest is the sole arbiter of emergency state.** `page.tsx:3083` builds the override envelope from flat manifest fields (`isEmergency`, `emergencyType`, ...), keeps the legacy nested shape as fallback, and treats any non-emergency 200 as a clear — `setActiveEmergency(em)` with `em=null` is idempotent. This is the P0-2 fix from 05-26 and it traces clean. A spoofed WS ALL_CLEAR re-confirms with the server before clearing (`page.tsx:3904`).

5. **Emergency overlay precedence is correct.** `EmergencyOverlay` renders at `z-[9999]` full-screen (`EmergencyOverlay.tsx:178`); the playlist content sits at `z-10`/`z-0`. The Chromium-83 strip (P0-5) is real — flex `gap` replaced by explicit margins, blur dropped, fixed-px max-height instead of `vh`. URL native overlay is force-hidden whenever `activeEmergency` is set (`page.tsx:4754`).

6. **Emergency cache tier is sacred.** `sw-player.js`: `EMERGENCY_FLOOR_BYTES = 1 GB` never evicted; `precacheEmergency` waits for a MessageChannel ack and only commits the page-side hash ref on `ok:true` (player-014 fix — partial pushes don't poison the next retry). Power-cycle ride-through via `LS_EMERGENCY_CACHE` localStorage. Refreshes every 5 min independent of manifest sync.

7. **Slide loop is throttle-proof.** `page.tsx:4280+` uses a 500ms self-correcting `setInterval` measuring `Date.now() - slideStartedAtRef` rather than a one-shot `setTimeout` — the documented fix for Goodview/Chromium-95 WebView aggressive timer throttling. Refs (not state) feed the loop so it never restarts mid-stream.

8. **Backoff is full-jitter everywhere.** `backoffMs(attempt, base, max=30s)` used on register retry (`:2703`), manifest poll fail (`:2817`), WS reconnect (`:4138`), content fetch (`:3395`). No thundering herd on fleet-wide reconnect.

9. **WebView hardening.** Main player WV: `allowFileAccess=false`, `allowContentAccess=false`, `mixedContentMode=MIXED_CONTENT_NEVER_ALLOW` (`MainActivity.kt:891-897`). Only ONE `addJavascriptInterface` (the `EduCmsNative` bridge). No `setWebContentsDebuggingEnabled(true)` anywhere in the codebase (would be a P1 if present in release).

10. **Four-layer crash recovery.** (a) `onRenderProcessGone` returns true + kicks recovery loop (`SafePlayerWebViewClient.kt:171`); (b) native 10-min freshness watchdog force-reloads a stale page (`MainActivity.kt:114`); (c) web heartbeat every 60s feeds that watchdog so a *healthy* page is never falsely reloaded (`WebAppBridge.kt:heartbeat`); (d) cross-process Manager watchdog: 90s threshold × 3 ticks → force-restart, with post-install grace-window rollback (`WatchdogService.kt:342-346`).

---

## FINDINGS

### P1 — this sprint

**PLAYER-P1-1 — Watchdog liveness does not prove the WebView is painting.**
`ManagerHeartbeatPublisher.kt:88` writes the heartbeat row from a `Handler.postDelayed` loop on the main looper, and the native 10-min watchdog (`MainActivity.kt`) is fed by `onWebHeartbeat` (the page's JS event loop) + `onPageFinishedOk`. **None of these three signals proves the compositor is actually painting frames.** A WebView whose JS loop is alive but whose GPU/compositor has stalled (a real failure mode on cheap LED-controller WebViews under memory pressure) keeps emitting the 60s web heartbeat → native watchdog stays satisfied → Manager heartbeat keeps writing → cross-process watchdog stays satisfied. The screen shows a frozen/black frame for the full week and no local layer recovers it. The ONLY thing that catches this is the *server-side* render-proof (`page.tsx:2500+`, which gates on the rAF paint counter advancing) surfacing the screen as RED in the dashboard — i.e. recovery depends on a human watching the fleet map, not on the device self-healing. **Fix:** feed the rAF paint-counter delta (already computed in `renderFramesRef`) into the web heartbeat so a frozen-but-alive page stops heartbeating → native 10-min watchdog reloads it autonomously. Evidence: `page.tsx:2487` (rAF counter exists), `WebAppBridge.kt:30` (heartbeat is liveness-only, no paint signal).

**PLAYER-P1-2 — Player toast UI uses Chromium-83-forbidden flex `gap` on the live kiosk surface.**
The OTA progress overlays and the update-prompt toasts render `flex ... gap-3` / `gap-4` directly in the player render tree: `page.tsx:5020` (`gap-3`), `:5091` (`gap-3`), `:7237` (`gap-3`), `:7282` (`gap-4`), plus the OtaProgressOverlay (`:7270`, `:7338` use `gap-3`/`gap-4`). Per CLAUDE.md #10, flex `gap` is Chrome 84+ and collapses on Taurus Chromium-83 → icon and text stick together. The EmergencyOverlay was correctly swept (P0-5) but these operator-facing OTA/update toasts were not. On a Taurus LED wall an OTA-in-progress toast would render with overlapping glyphs. The `taurus-safety` baseline shows `gap=1196` tolerated, so these are inside the ratchet and CI won't flag them — but they're on a *shipped player surface*. **Fix:** replace `gap-N` with explicit child margins on these specific toasts (same pattern as EmergencyOverlay's `ml-4`). Lower severity than emergency because OTA toasts are transient, but it's the same regression class on the same hardware target.

**PLAYER-P1-3 — KNOWN-OPEN (task #9): D-pad navigation in the sideload setup dialog is partial.**
Task #9 is still `in_progress`. `applyRemoteFocus` (`MainActivity.kt:631`) wires focusability + a theme-independent highlight onto AlertDialog buttons and `requestFocus()` on the positive button, and the URL-overlay WebView gets explicit focus for the spatial-nav shim (`MainActivity.kt:1272`). This covers the install-permission and update dialogs. But there's no evidence of a full D-pad traversal model across the *pairing/gate* screen's native views (the `managerGateRetry` button etc.) — a remote-only TV/LED-controller operator may still be unable to reach every control without a touchscreen or mouse. Verify on real D-pad hardware before declaring #9 done. Evidence: `MainActivity.kt:1545` surfaces `managerGateRetry` with no focus wiring shown.

### P2 — sprint

**PLAYER-P2-1 — `databaseEnabled = true` on both WebViews (deprecated WebSQL).**
`MainActivity.kt:889` and `:1274` set `databaseEnabled = true`. WebSQL is removed from modern Chromium and deprecated everywhere; the player doesn't use it (it uses the SW Cache API + localStorage). Harmless today but dead config on a security-sensitive surface. Drop it. Evidence: no WebSQL usage anywhere in `apps/web/src/app/player`.

**PLAYER-P2-2 — Manifest poll fires a fresh `setInterval(tick, 3000)` AND a `pollFails`-driven backoff timer that can briefly double-poll.**
`page.tsx:2824` sets a 3s interval; on `pollFails >= 3` it clears the interval and schedules a single `setTimeout(tick, backoff)` (`:2817-2821`). The recovery path re-establishes the 3s interval on the next successful tick. There's a narrow window where a backoff `setTimeout` and a not-yet-cleared interval could both be pending, producing one extra manifest GET. Not harmful (manifest is cheap + idempotent) but worth tightening to a single self-scheduling loop like the slide heartbeat uses. Evidence: `page.tsx:2776-2826`.

**PLAYER-P2-3 — Pairing-code length mismatch between QR extractor, manual input, and the log.**
`pair/page.tsx`: the manual `<input maxLength={12}>` (`:209`) and `extractCode` accept `[A-Z0-9]{4,12}` (`:71`), but the success log slices to 6 chars (`:45`, `slice(0,6)`) and the help text says "type the 6-digit code" (`:153`). If the server ever issues a code longer than 6, the log would truncate it (cosmetic) and the help copy would mislead. Confirm the server's pairing-code length is fixed at 6 and tighten the regex to match, OR fix the copy. Low risk (the body sends the full untruncated code at `:49`), purely a consistency/observability nit. Evidence: `pair/page.tsx:45,71,153,209`.

**PLAYER-P2-4 — `mediaPlaybackRequiresUserGesture = false` is correct for signage, but the playlist-item iframe path has `No sandbox attribute` (by design) — document the residual.**
`page.tsx:6033` deliberately omits `sandbox` on the proxied URL iframe because `allow-scripts allow-same-origin` broke e-arc.com and the script-strip in the proxy is the frame-busting defense. This is a defensible call and traced, but it means the player's URL-asset path trusts the proxy's `<script>` strip as its only XSS boundary for arbitrary operator-pasted URLs. Already an accepted trade-off; just ensure SECURITY_GAPS.md names it so a district reviewer hears it from you. Evidence: `page.tsx:6033-6037`, `WidgetRenderer.tsx:2968`.

### P3 — polish

- **PLAYER-P3-1** — `getCacheStatus` resolves `{supported:true, ...0}` on a 2s timeout rather than surfacing "SW busy" — fine for an info overlay, but the count can read 0 transiently mid-precache. (`offline-cache.ts:124`.)
- **PLAYER-P3-2** — The "no bridge" OTA fallback copy tells the operator to wait for the "6-hour check or reboot" (`page.tsx:7240`); the actual periodic worker comment elsewhere says 6h — consistent, but verify the OtaWorker's real interval matches the copy so the promise isn't stale.
- **PLAYER-P3-3** — Live API health currently reports `db:"degraded"` (curl output, 2026-06-10). Player tolerates this (manifest poll retries), but it's worth confirming this is the `connection_limit` gotcha from MEMORY and not a real outage during the launch window.

---

## Web-vs-APK behavior gaps (explicit list, as assigned)

| Behavior | Web (`/player` in a browser) | Android APK | Gap impact |
|---|---|---|---|
| Renderer-crash recovery | Browser handles tab crash; web has no `onRenderProcessGone` hook | `onRenderProcessGone` → recovery loop + reload | APK strictly better; web kiosks on a Pi-Chromium rely on the browser |
| Stale-page watchdog | None (browser tab just sits) | Native 10-min freshness watchdog + 60s web heartbeat | A web-only kiosk (no APK) has no autonomous frozen-page recovery beyond server render-proof |
| Cross-process restart | None | Manager APK 90s×3 → force-restart + rollback | Web-only deploys have zero process supervision |
| Orientation lock | CSS/viewport only (browser fullscreen) | `setRequestedOrientation` persisted pre-manifest | Web can't hard-lock orientation against OEM sensor |
| Kiosk pinning | Browser kiosk mode (OS-dependent) | Device-Owner lock-task (opt-in) | Parity only if web kiosk uses OS-level kiosk mode |
| OTA self-update | Page soft-reload on SHA mismatch (code only) | Full APK OTA via Manager (native + web) | Web gets code updates instantly; APK shell needs the OTA chain |
| D-pad / remote nav | Browser default focus | `applyRemoteFocus` + spatial-nav shim | APK has explicit remote handling; web depends on browser focus ring |
| Native URL overlay | Falls back to proxied iframe | `EduCmsNative.showUrlOverlay` native WebView | APK renders URLs in a separate hardened WebView; web renders inline |
| CTS serial (sports) | Web Serial API (Chrome desktop only) | Native `SerialPortBridge` (/dev/ttyS*) | APK supports ECBox3576 UART; web limited to Web Serial |
| Device-token storage | localStorage | localStorage via DeviceStore | Same (H6 accepted risk both sides) |

**Net:** the APK is the production target and is materially more resilient. A **web-only kiosk (browser on a Pi/generic Android box) is missing the entire native supervision stack** (watchdog, renderer-crash recovery, OTA, orientation hard-lock) — it survives on the web recovery loop + SW cache alone. That's adequate for short demos but the "unattended for a week" guarantee really only holds on the APK. Worth stating explicitly in deploy docs so nobody ships a browser-tab kiosk into a hallway expecting APK-grade reliability.

---

## What I did NOT fully verify (honest gaps)

- Did not flash a real APK / run on physical Taurus or Goodview hardware — Kotlin reviewed statically only.
- Did not exercise a live pairing end-to-end (would require a real unpaired screen + admin session; hard rule against mutating live data). Confirmed the page renders 200 and the submit path posts the full code.
- Did not measure real OTA install timing against the toast copy.
- Multi-panel LED auto-fit floor (≥50px / clamp-to-min) read in code (`page.tsx:6180+`) but not rendered on a real 320×1080 panel.
