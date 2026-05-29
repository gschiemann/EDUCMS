# Player Audit — VenueOS (web route + Android APK)

> Opus 4.8 read-only, 2026-05-28 (Wave 3). Web player (`apps/web/src/app/player/**`,
> `components/player/**`, `public/sw-player.js`) + APK (`apps/player/**`). Standard Audit
> Surface §1/§2/§15 + Sprint 7. Every claim verified against code, not comments.

## Verdict: PRODUCTION-GRADE for a live K-12 deploy.
Both the life-safety render path and offline-first architecture are real, not costume.
Several documented-as-broken safeguards are genuinely FIXED here (SHA-256 "theater",
`verifyMessage` no-caller gap, inset collapse). **Emergency rendering is the strongest part.**

## Status (all WORKS unless noted)
- **Render:** TemplateScaler transform:scale with 2-RAF Taurus 0-offsetWidth recovery (`page.tsx:7247-7365`); per-zone WidgetErrorBoundary + inline fallback (`5176-5354`); image/video/PDF/webpage with onError-advance + X-Frame proxy (`5665-5887`). scale-to-0 only until measured (RAF×2 + ResizeObserver recover).
- **Emergency (strongest):** per-screen `ScreenEmergencyOverride` resolved FIRST + 4-tier playlist fallback, orientation/location-aware (`screens.controller.ts:2394-2569`); OVERRIDE/ALL_CLEAR manifest-arbitrated (forged ALL_CLEAR can't drop a real alert — re-fetch re-asserts); all 5 WS types (SOS/TEXT_BROADCAST/MEDIA_ALERT/REFRESH_WEB/CHECK_FOR_UPDATES) handled on WS + SSE + HTTP-poll, signature+freshness+dedup gated; **text-only fallback SERVER-synthesized** (`:2659-2701`) so it works with zero cached media; EmergencyOverlay `aria-live=assertive`, Chromium-83-safe WITHOUT polyfill timing (uses `ml-*` not flex gap).
- **Offline (Sprint 7):** SW cache tiers playlist + emergency-never-evict, copy-forward on VERSION bump (`sw-player.js:363-452`); **real SHA-256 verify** recomputed from body bytes, refuses on mismatch (`509-529` — old self-compare theater FIXED); manifest→SW prefetch w/ MessageChannel ack + retry (`page.tsx:2383-2418`); HTTP-poll 5s fallback + SSE tier; Range-request 206 synthesis for offline looping video (`sw-player.js:181-216`).
- **Chromium-83:** inset inline+class global attribute-selector polyfill (`layout.tsx:199-215`), 0 inset-* left; flex gap runtime polyfill + EmergencyOverlay gap-free; taurus-safety CI ratchet works.
- **OTA (historical pain — now robust):** flag clears ONLY on versionCode bump (`player-ota.controller.ts:99-135`); `semverGte` loop-breaker (`:464`); stalled-install auto-clear (`:259-277`); `release-apk.sh` atomic bump+tag; **version-tag-sync CI guard now HAS the v1.0.66-incident hardening** (`deploy-reliability.yml:65-82`) — the CLAUDE.md memory note that this guard misses it is now STALE.
- **APK:** USB ingest crypto core solid (HMAC manifest + per-asset SHA + tenant bind, `UsbIngester.kt`); heartbeat 30s (`HeartbeatService.kt`); kiosk WebView locked (`allowFileAccess=false`, `mixedContentMode=NEVER_ALLOW`, no debugging); serial bridge real stty+read loop (`SerialPortBridge.kt:130-249`); pairing state machine + never-give-up retry.

## Ranked defects
**P1 — cq-unit polyfill UNVERIFIED on real Chromium-83 (biggest risk).** 908 `cqh`/`cqw` across 59 widget `<style>` blocks rely on `cq-unit-polyfill.ts:117-164` reading `cssText` + rewriting to px. **Untested assumption:** that Chromium 83 PRESERVES the raw cssText of a declaration containing an invalid `cqh` unit (vs dropping the whole declaration at parse → polyfill has nothing to read). No real-hardware/old-Chromium test (CLAUDE.md §21). If 83 drops it → 59 widgets silently mis-size on Taurus. Plus a first-paint→RAF window mis-sizes briefly even when it works. **NOTE: the emergency surface does NOT use cq-units → worst case degrades signage aesthetics, NOT life-safety.** Fix: a WebKit/old-Chromium Playwright assertion (port `holiday-bridge.cjs`) loading a cqh-heavy widget, assert computed font-size ≠ fallback.

**P2 — USB emergency-asset ingest lacks documented kiosk safeguards.** `UsbIngestActivity.kt:25-26` ships "V1 scaffold": NO operator admin-PIN prompt, NO escalated confirmation for emergency-asset updates, NO server AuditLog (`source:USB`+serial+hashes) — all 3 are Sprint 7 requirements. Crypto core solid + `usbIngestEnabled` flag gates key issuance (off by default), so not wide-open, but a physically-present actor with a validly-signed bundle can silently swap emergency content with zero on-device confirmation + zero forensic trail when the flag is on. Fix: kiosk PIN dialog + emergency-tier confirm + audit POST from `UsbIngester.ingest` Accepted path.

**P3 — `runStty` shell interpolation** (`SerialPortBridge.kt:301`) — `sh -c "stty -F $devicePath …"`; path validated `startsWith("/dev/tty")` but not metachar-screened. Reachable only via player-origin `@JavascriptInterface` (needs player-origin XSS = already game-over) → low sev; switch to `Runtime.exec(arrayOf("stty","-F",devicePath,…))`.

**P3 — leftover prod diagnostics** — 9 console.log/warn in `page.tsx` incl. a `[touch]` block (`:203-226`) marked "2026-05-14 temporary diagnostic… remove" — ~2wks stale, noise on a 24/7 kiosk.

**Housekeeping (not a player defect):** ~75 stale `.claude/worktrees/agent-*` pollute repo-wide find/grep — `git worktree prune` when unlocked.

## Web-route vs APK split
- **Web route:** no functional defects. Single material risk = cq-unit polyfill unverified on real Chromium-83 (P1, aesthetic not life-safety).
- **APK:** OTA robustly defended now; one genuine gap = USB emergency ingest without PIN/escalation/audit (P2, flag-gated off).

## ACTIONABLE FIX LIST
1. **(P1)** Add an old-Chromium/WebKit Playwright check that a cqh-heavy widget computes a real (non-fallback) font-size — close the "unverified on Taurus" gap. + consider hiding text until polyfill first-run to kill the first-paint mis-size.
2. **(P2)** USB ingest: kiosk admin-PIN dialog + emergency-asset escalation confirm + server AuditLog POST (`source:USB`).
3. **(P3)** `runStty` → arg-array exec; strip the stale `[touch]` diagnostic block + the other 8 console logs.
4. Housekeeping: `git worktree prune` the ~75 stale agent worktrees.
